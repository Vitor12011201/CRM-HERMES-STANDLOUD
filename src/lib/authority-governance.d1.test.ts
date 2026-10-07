import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  canonicalizeAuthoritySubject,
  createAuthorityEvaluator,
  prepareAuthorizedAuthorityInvocation,
  type AuthorityInvocationRequest,
} from "./authority";
import {
  authorityGovernanceActionKey,
  computeCanonicalEligibilityRuleSetChildSha256,
  createAuthorityGovernanceWriter,
  type AuthorityGovernanceD1Database,
  type AuthorityGovernanceWriter,
  type GovernedEligibilityRuleProposal,
  type GovernedEligibilityRuleSetVersionCommitInput,
  type GovernedPolicyVersionCommitInput,
} from "./authority-governance";

const repositoryRoot = process.cwd();
const wranglerEntry = join(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const defaultDatabaseName = "standloud-crm-prod";
const localDatabaseId = "5e3373f0-79c0-452b-8f51-abfcb23b2931";
const timestamp = "2026-10-07T00:00:00.000Z";
const sha = (character: string) => character.repeat(64);

type LocalD1Database = AuthorityGovernanceD1Database & {
  batch(statements: readonly ReturnType<AuthorityGovernanceD1Database["prepare"]>[]): Promise<unknown[]>;
};

let temporaryRoot: string;
let miniflare: Miniflare;
let database: LocalD1Database;
let writer: AuthorityGovernanceWriter;
let invocationSequence = 0;

function runWrangler(args: string[]) {
  return execFileSync(process.execPath, [wranglerEntry, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function execute(query: string, ...values: unknown[]) {
  await database.batch([database.prepare(query).bind(...values)]);
}

async function count(table: string, where: string, ...values: unknown[]) {
  const row = await database.prepare(`SELECT count(*) AS "count" FROM "${table}" WHERE ${where}`).bind(...values).first<{ count: number }>();
  return row?.count ?? 0;
}

async function insertSubject(id: string, subject: AuthorityInvocationRequest["subject"]) {
  const descriptor = await canonicalizeAuthoritySubject(subject);
  await execute(`
INSERT INTO "AuthoritySubjectRef" (
  "id", "registryVersion", "subjectType", "subjectId", "versionKind", "versionToken", "descriptorFormat", "canonicalKey", "descriptorSha256"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`, id, descriptor.registryVersion, descriptor.subjectType, descriptor.subjectId, descriptor.versionKind, descriptor.versionToken, descriptor.format, descriptor.canonicalKey, descriptor.descriptorSha256);
}

async function insertGovernanceDecision(input: Readonly<{
  id: string;
  subjectRefId: string;
  familyKind: "POLICY" | "ELIGIBILITY_RULESET";
  familyKey: string;
  expectedPredecessorId: string;
  nextRevision: number;
  recordKind: string;
  contentSha256: string;
}>) {
  await execute(`
INSERT INTO "Decision" (
  "id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "conditionsSchemaKey", "conditionsJson", "conditionsSha256", "issuedAt"
) VALUES (?, ?, ?, 'APPROVED', 'actor-human', ?, 'policy-governance-1', 'authority-kernel-governance-proposal/v1', ?, ?, ?)
`, input.id, `request:${input.id}`, authorityGovernanceActionKey, input.subjectRefId, JSON.stringify({
    familyKind: input.familyKind,
    familyKey: input.familyKey,
    expectedPredecessorId: input.expectedPredecessorId,
    nextRevision: input.nextRevision,
    recordKind: input.recordKind,
    proposedContentSha256: input.contentSha256,
  }), sha("9"), timestamp);
}

function governanceInvocation(input: Readonly<{
  key: string;
  decisionId: string;
  subject: AuthorityInvocationRequest["subject"];
}>): GovernedPolicyVersionCommitInput["invocation"] {
  return {
    invocationKey: input.key,
    normativeActionKey: authorityGovernanceActionKey,
    capabilityKey: "authority.governance.commit",
    executorActorId: "actor-human",
    executorType: "HUMAN_EXECUTOR",
    subject: input.subject,
    requestedAuthorityMode: "HUMAN_GATED",
    policyKey: "policy.governance",
    ruleSetKey: "rules-governance",
    decisionId: input.decisionId,
    evaluatedAt: timestamp,
  };
}

async function setupPolicy(name: string, options: Readonly<{ recordKind?: "POLICY" | "REVOCATION"; contentSha256?: string }> = {}): Promise<GovernedPolicyVersionCommitInput> {
  const recordKind = options.recordKind ?? "POLICY";
  const baseId = `policy-base-${name}`;
  const policyKey = `policy.target.${name}`;
  const subject = {
    registryVersion: "registry/v1",
    subjectType: "POLICY_FAMILY_DESCRIPTOR",
    subjectId: policyKey,
    versionKind: "EXACT_VERSION" as const,
    versionToken: baseId,
  };
  await execute(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "bootstrapKey"
) VALUES (?, ?, 1, 'POLICY', 'TARGET_ACTION', 'POLICY_GOVERNED', 'scope/v1', '1', '{}', ?, 'PRESERVE', 'AUTHORITY_BOOTSTRAP_V1')
`, baseId, policyKey, sha("a"));
  const subjectRefId = `subject-policy-${name}`;
  await insertSubject(subjectRefId, subject);
  const proposal = {
    id: `policy-next-${name}`,
    policyKey,
    expectedPredecessorPolicyVersionId: baseId,
    nextRevision: 2,
    recordKind,
    normativeActionKey: "TARGET_ACTION",
    authorityMode: "POLICY_GOVERNED" as const,
    scopeSchemaKey: "scope/v1",
    scopeSchemaVersion: "1",
    definitionJson: recordKind === "POLICY" ? "{}" : null,
    contentSha256: options.contentSha256 ?? sha("b"),
    priorDecisionDisposition: recordKind === "POLICY" ? "PRESERVE" as const : "INVALIDATE" as const,
    reasonCode: recordKind === "POLICY" ? null : "GOVERNANCE_REVOCATION",
    governanceDecisionId: `decision-policy-${name}`,
  };
  await insertGovernanceDecision({
    id: proposal.governanceDecisionId,
    subjectRefId,
    familyKind: "POLICY",
    familyKey: policyKey,
    expectedPredecessorId: baseId,
    nextRevision: proposal.nextRevision,
    recordKind,
    contentSha256: proposal.contentSha256,
  });
  return { invocation: governanceInvocation({ key: `invoke-policy-${name}`, decisionId: proposal.governanceDecisionId, subject }), proposal };
}

async function setupRuleSet(name: string, disabled = false, childRules?: readonly GovernedEligibilityRuleProposal[]): Promise<GovernedEligibilityRuleSetVersionCommitInput> {
  const baseId = `rules-base-${name}`;
  const ruleSetKey = `rules.target.${name}`;
  const subject = {
    registryVersion: "registry/v1",
    subjectType: "ELIGIBILITY_RULESET_FAMILY_DESCRIPTOR",
    subjectId: ruleSetKey,
    versionKind: "EXACT_VERSION" as const,
    versionToken: baseId,
  };
  await execute(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" (
  "id", "ruleSetKey", "revision", "recordKind", "contractCatalogRevision", "contentSha256", "bootstrapKey"
) VALUES (?, ?, 1, 'RULESET', 'catalog/v1', ?, 'AUTHORITY_BOOTSTRAP_V1')
`, baseId, ruleSetKey, sha("c"));
  const subjectRefId = `subject-rules-${name}`;
  await insertSubject(subjectRefId, subject);
  const rules = disabled ? [] : childRules ?? [{
    id: `rule-next-${name}`,
    capabilityKey: `capability.${name}`,
    contractVariantKey: "DEFAULT",
    executorType: "HUMAN_EXECUTOR" as const,
    verdict: "ELIGIBLE" as const,
    conditionsSchemaKey: null,
    conditionsJson: null,
    ruleSha256: sha("d"),
  }];
  const contentSha256 = disabled ? sha("e") : await computeCanonicalEligibilityRuleSetChildSha256(rules);
  const proposal = {
    id: `rules-next-${name}`,
    ruleSetKey,
    expectedPredecessorRuleSetVersionId: baseId,
    nextRevision: 2,
    recordKind: disabled ? "DISABLED" as const : "RULESET" as const,
    contractCatalogRevision: "catalog/v1",
    contentSha256,
    governanceDecisionId: `decision-rules-${name}`,
    childRules: rules,
  };
  await insertGovernanceDecision({
    id: proposal.governanceDecisionId,
    subjectRefId,
    familyKind: "ELIGIBILITY_RULESET",
    familyKey: ruleSetKey,
    expectedPredecessorId: baseId,
    nextRevision: proposal.nextRevision,
    recordKind: proposal.recordKind,
    contentSha256,
  });
  return { invocation: governanceInvocation({ key: `invoke-rules-${name}`, decisionId: proposal.governanceDecisionId, subject }), proposal };
}

async function insertInvocationOnly(request: AuthorityInvocationRequest, id: string) {
  const evaluation = await createAuthorityEvaluator(database).evaluateInvocation(request);
  if (evaluation.outcome !== "AUTHORIZED") throw new Error(`fixture authorization failed: ${evaluation.outcome === "DENIED" ? evaluation.reasonCode : evaluation.reasonCode}`);
  const prepared = await prepareAuthorizedAuthorityInvocation(request, evaluation);
  await execute(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "contractVariantKey", "executorActorId", "executorType", "subjectRefId", "caseSubjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "decisionId", "delegationGrantId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, id, prepared.fields.invocationKey, prepared.fields.canonicalRequestSha256, prepared.fields.normativeActionKey, prepared.fields.capabilityKey, prepared.fields.contractVariantKey, prepared.fields.executorActorId, prepared.fields.executorType, prepared.fields.subjectRefId, prepared.fields.caseSubjectRefId, prepared.fields.policyVersionId, prepared.fields.eligibilityRuleSetVersionId, prepared.fields.eligibilityRuleId, prepared.fields.decisionId, prepared.fields.delegationGrantId, prepared.fields.outcome, prepared.fields.lineageSha256, prepared.fields.evaluatedAt);
}

describe("TR-03D atomic authority-kernel governance commits", () => {
  beforeAll(async () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), "standloud-tr03d-"));
    const persistPath = join(temporaryRoot, "persist");
    runWrangler(["d1", "migrations", "apply", defaultDatabaseName, "--local", "--persist-to", persistPath]);
    miniflare = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: "", resourcePersistencePath: join(persistPath, "v3"), d1Databases: { DATABASE: localDatabaseId },
    }));
    database = await miniflare.getD1Database("DATABASE") as unknown as LocalD1Database;
    await execute(`INSERT INTO "Actor" ("id", "category") VALUES ('actor-principal', 'HUMAN'), ('actor-human', 'HUMAN')`);
    await execute(`
INSERT INTO "AuthorityBootstrapReceipt" ("bootstrapKey", "manifestVersion", "manifestSha256", "manifestSourceRef", "principalActorId", "provisionedAt")
VALUES ('AUTHORITY_BOOTSTRAP_V1', 'tr03d-manifest/v1', ?, 'disposable-test-only', 'actor-principal', ?)
`, sha("f"), timestamp);
    await execute(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "bootstrapKey"
) VALUES ('policy-governance-1', 'policy.governance', 1, 'POLICY', ?, 'HUMAN_GATED', 'scope/v1', '1', '{}', ?, 'PRESERVE', 'AUTHORITY_BOOTSTRAP_V1')
`, authorityGovernanceActionKey, sha("1"));
    await execute(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" ("id", "ruleSetKey", "revision", "recordKind", "contractCatalogRevision", "contentSha256", "bootstrapKey")
VALUES ('rules-governance-1', 'rules-governance', 1, 'RULESET', 'catalog/v1', ?, 'AUTHORITY_BOOTSTRAP_V1')
`, sha("2"));
    await execute(`
INSERT INTO "ExecutorEligibilityRule" ("id", "ruleSetVersionId", "capabilityKey", "contractVariantKey", "executorType", "verdict", "ruleSha256")
VALUES ('rule-governance', 'rules-governance-1', 'authority.governance.commit', 'DEFAULT', 'HUMAN_EXECUTOR', 'ELIGIBLE', ?)
`, sha("3"));
    writer = createAuthorityGovernanceWriter(database, { createInvocationId: () => `invocation-${++invocationSequence}` });
  }, 120_000);

  afterAll(async () => {
    await miniflare?.dispose();
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("commits governed POLICY and REVOCATION successors atomically", async () => {
    const policy = await setupPolicy("valid-policy");
    const revocation = await setupPolicy("valid-revocation", { recordKind: "REVOCATION", contentSha256: sha("4") });
    await expect(writer.commitGovernedPolicyVersion(policy)).resolves.toMatchObject({ status: "COMMITTED" });
    await expect(writer.commitGovernedPolicyVersion(revocation)).resolves.toMatchObject({ status: "COMMITTED" });
    expect(await count("AuthorityInvocation", '"invocationKey" = ?', policy.invocation.invocationKey)).toBe(1);
    expect(await count("AuthorityPolicyVersion", '"id" = ?', policy.proposal.id)).toBe(1);
    expect(await count("AuthorityInvocation", '"invocationKey" = ?', revocation.invocation.invocationKey)).toBe(1);
    expect(await count("AuthorityPolicyVersion", '"id" = ? AND "recordKind" = \'REVOCATION\'', revocation.proposal.id)).toBe(1);
  });

  it("rejects a stale/wrong policy predecessor without committing either row", async () => {
    const input = await setupPolicy("wrong-predecessor");
    const wrong = { ...input, proposal: { ...input.proposal, expectedPredecessorPolicyVersionId: "policy-missing" } };
    await expect(writer.commitGovernedPolicyVersion(wrong)).resolves.toMatchObject({ status: "DENIED" });
    expect(await count("AuthorityInvocation", '"invocationKey" = ?', input.invocation.invocationKey)).toBe(0);
    expect(await count("AuthorityPolicyVersion", '"id" = ?', input.proposal.id)).toBe(0);
  });

  it("rejects a governance Decision revoked before policy commit", async () => {
    const input = await setupPolicy("decision-revoked");
    await execute(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt")
VALUES ('decision-effect-revoke-policy', 'request:effect-revoke-policy', ?, 'APPROVED', 'actor-human', ?, 'policy-governance-1', ?)
`, authorityGovernanceActionKey, `subject-policy-decision-revoked`, timestamp);
    await execute(`INSERT INTO "AuthorityRelation" ("id", "effectingDecisionId", "relationKind", "targetDecisionId") VALUES ('relation-revoke-policy', 'decision-effect-revoke-policy', 'REVOKES', ?)` , input.proposal.governanceDecisionId);
    await expect(writer.commitGovernedPolicyVersion(input)).resolves.toMatchObject({ status: "DENIED" });
    expect(await count("AuthorityInvocation", '"invocationKey" = ?', input.invocation.invocationKey)).toBe(0);
    expect(await count("AuthorityPolicyVersion", '"id" = ?', input.proposal.id)).toBe(0);
  });

  it("returns ALREADY_COMMITTED for the same policy key/digest and detects a changed digest", async () => {
    const input = await setupPolicy("policy-retry");
    await expect(writer.commitGovernedPolicyVersion(input)).resolves.toMatchObject({ status: "COMMITTED" });
    await expect(writer.commitGovernedPolicyVersion(input)).resolves.toMatchObject({ status: "ALREADY_COMMITTED" });
    const changed = { ...input, proposal: { ...input.proposal, contentSha256: sha("5") } };
    await expect(writer.commitGovernedPolicyVersion(changed)).resolves.toMatchObject({ status: "DIGEST_MISMATCH" });
  });

  it("requires reconciliation when a policy invocation exists without its consequence", async () => {
    const input = await setupPolicy("policy-incomplete");
    const request: AuthorityInvocationRequest = {
      ...input.invocation,
      governanceProposal: { familyKind: "POLICY", familyKey: input.proposal.policyKey, expectedPredecessorId: input.proposal.expectedPredecessorPolicyVersionId, nextRevision: input.proposal.nextRevision, recordKind: input.proposal.recordKind, proposedContentSha256: input.proposal.contentSha256 },
      governanceConsequence: {
        familyKind: "POLICY", successorId: input.proposal.id, policyKey: input.proposal.policyKey, expectedPredecessorId: input.proposal.expectedPredecessorPolicyVersionId, nextRevision: input.proposal.nextRevision, recordKind: input.proposal.recordKind, normativeActionKey: input.proposal.normativeActionKey, authorityMode: input.proposal.authorityMode, scopeSchemaKey: input.proposal.scopeSchemaKey, scopeSchemaVersion: input.proposal.scopeSchemaVersion, definitionJson: input.proposal.definitionJson, proposedContentSha256: input.proposal.contentSha256, priorDecisionDisposition: input.proposal.priorDecisionDisposition, reasonCode: input.proposal.reasonCode,
      },
    };
    await insertInvocationOnly(request, "orphan-policy-invocation");
    await expect(writer.commitGovernedPolicyVersion(input)).resolves.toMatchObject({ status: "RECONCILIATION_REQUIRED" });
  });

  it("commits complete RULESET children atomically and commits DISABLED without children", async () => {
    const rules = await setupRuleSet("valid-rules", false, [{
      id: "rule-valid-rules-a", capabilityKey: "capability.valid.a", contractVariantKey: "DEFAULT", executorType: "HUMAN_EXECUTOR", verdict: "ELIGIBLE", conditionsSchemaKey: null, conditionsJson: null, ruleSha256: sha("6"),
    }, {
      id: "rule-valid-rules-b", capabilityKey: "capability.valid.b", contractVariantKey: "DEFAULT", executorType: "DETERMINISTIC_SYSTEM", verdict: "INELIGIBLE", conditionsSchemaKey: null, conditionsJson: null, ruleSha256: sha("7"),
    }]);
    const disabled = await setupRuleSet("disabled-rules", true);
    await expect(writer.commitGovernedEligibilityRuleSetVersion(rules)).resolves.toMatchObject({ status: "COMMITTED" });
    await expect(writer.commitGovernedEligibilityRuleSetVersion(disabled)).resolves.toMatchObject({ status: "COMMITTED" });
    expect(await count("ExecutorEligibilityRule", '"ruleSetVersionId" = ?', rules.proposal.id)).toBe(2);
    expect(await count("AuthorityInvocation", '"invocationKey" = ?', rules.invocation.invocationKey)).toBe(1);
    expect(await count("ExecutorEligibilityRule", '"ruleSetVersionId" = ?', disabled.proposal.id)).toBe(0);
  });

  it("rolls back invocation, parent, and all children when one ruleset child violates D1", async () => {
    const input = await setupRuleSet("invalid-child", false, [{
      id: "rule-valid-invalid-child", capabilityKey: "capability.invalid.a", contractVariantKey: "DEFAULT", executorType: "HUMAN_EXECUTOR", verdict: "ELIGIBLE", conditionsSchemaKey: null, conditionsJson: null, ruleSha256: sha("8"),
    }, {
      id: "rule-governance", capabilityKey: "capability.invalid.b", contractVariantKey: "DEFAULT", executorType: "HUMAN_EXECUTOR", verdict: "ELIGIBLE", conditionsSchemaKey: null, conditionsJson: null, ruleSha256: sha("a"),
    }]);
    await expect(writer.commitGovernedEligibilityRuleSetVersion(input)).resolves.toMatchObject({ status: "DENIED" });
    expect(await count("AuthorityInvocation", '"invocationKey" = ?', input.invocation.invocationKey)).toBe(0);
    expect(await count("ExecutorEligibilityRuleSetVersion", '"id" = ?', input.proposal.id)).toBe(0);
    expect(await count("ExecutorEligibilityRule", '"id" = ?', "rule-valid-invalid-child")).toBe(0);
  });

  it("rejects wrong/racy ruleset heads and a revoked governance Decision", async () => {
    const wrong = await setupRuleSet("wrong-rules");
    const wrongInput = { ...wrong, proposal: { ...wrong.proposal, expectedPredecessorRuleSetVersionId: "rules-missing" } };
    await expect(writer.commitGovernedEligibilityRuleSetVersion(wrongInput)).resolves.toMatchObject({ status: "DENIED" });
    const revoked = await setupRuleSet("revoked-rules");
    await execute(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt")
VALUES ('decision-effect-revoke-rules', 'request:effect-revoke-rules', ?, 'APPROVED', 'actor-human', ?, 'policy-governance-1', ?)
`, authorityGovernanceActionKey, "subject-rules-revoked-rules", timestamp);
    await execute(`INSERT INTO "AuthorityRelation" ("id", "effectingDecisionId", "relationKind", "targetDecisionId") VALUES ('relation-revoke-rules', 'decision-effect-revoke-rules', 'REVOKES', ?)` , revoked.proposal.governanceDecisionId);
    await expect(writer.commitGovernedEligibilityRuleSetVersion(revoked)).resolves.toMatchObject({ status: "DENIED" });
    expect(await count("ExecutorEligibilityRuleSetVersion", '"id" = ?', revoked.proposal.id)).toBe(0);
  });

  it("reconciles complete rulesets exactly, detects digest mismatch, and refuses incomplete consequences", async () => {
    const retry = await setupRuleSet("rules-retry");
    await expect(writer.commitGovernedEligibilityRuleSetVersion(retry)).resolves.toMatchObject({ status: "COMMITTED" });
    await expect(writer.commitGovernedEligibilityRuleSetVersion(retry)).resolves.toMatchObject({ status: "ALREADY_COMMITTED" });
    const changedRules = retry.proposal.childRules.map((rule, index) => index === 0 ? { ...rule, ruleSha256: sha("b") } : rule);
    const changed = { ...retry, proposal: { ...retry.proposal, childRules: changedRules, contentSha256: await computeCanonicalEligibilityRuleSetChildSha256(changedRules) } };
    await expect(writer.commitGovernedEligibilityRuleSetVersion(changed)).resolves.toMatchObject({ status: "DIGEST_MISMATCH" });

    const incomplete = await setupRuleSet("rules-incomplete");
    const childDigest = await computeCanonicalEligibilityRuleSetChildSha256(incomplete.proposal.childRules);
    const request: AuthorityInvocationRequest = {
      ...incomplete.invocation,
      governanceProposal: { familyKind: "ELIGIBILITY_RULESET", familyKey: incomplete.proposal.ruleSetKey, expectedPredecessorId: incomplete.proposal.expectedPredecessorRuleSetVersionId, nextRevision: incomplete.proposal.nextRevision, recordKind: incomplete.proposal.recordKind, proposedContentSha256: incomplete.proposal.contentSha256 },
      governanceConsequence: { familyKind: "ELIGIBILITY_RULESET", successorId: incomplete.proposal.id, ruleSetKey: incomplete.proposal.ruleSetKey, expectedPredecessorId: incomplete.proposal.expectedPredecessorRuleSetVersionId, nextRevision: incomplete.proposal.nextRevision, recordKind: incomplete.proposal.recordKind, contractCatalogRevision: incomplete.proposal.contractCatalogRevision, proposedContentSha256: incomplete.proposal.contentSha256, childRuleSetSha256: childDigest },
    };
    await insertInvocationOnly(request, "orphan-rules-invocation");
    await expect(writer.commitGovernedEligibilityRuleSetVersion(incomplete)).resolves.toMatchObject({ status: "RECONCILIATION_REQUIRED" });
  });

  it("rejects a stale prepared policy authorization after a legitimate target replacement", async () => {
    const input = await setupPolicy("stale-prepared");
    const request: AuthorityInvocationRequest = {
      ...input.invocation,
      governanceProposal: { familyKind: "POLICY", familyKey: input.proposal.policyKey, expectedPredecessorId: input.proposal.expectedPredecessorPolicyVersionId, nextRevision: input.proposal.nextRevision, recordKind: input.proposal.recordKind, proposedContentSha256: input.proposal.contentSha256 },
      governanceConsequence: { familyKind: "POLICY", successorId: input.proposal.id, policyKey: input.proposal.policyKey, expectedPredecessorId: input.proposal.expectedPredecessorPolicyVersionId, nextRevision: input.proposal.nextRevision, recordKind: input.proposal.recordKind, normativeActionKey: input.proposal.normativeActionKey, authorityMode: input.proposal.authorityMode, scopeSchemaKey: input.proposal.scopeSchemaKey, scopeSchemaVersion: input.proposal.scopeSchemaVersion, definitionJson: input.proposal.definitionJson, proposedContentSha256: input.proposal.contentSha256, priorDecisionDisposition: input.proposal.priorDecisionDisposition, reasonCode: input.proposal.reasonCode },
    };
    await expect(createAuthorityEvaluator(database).evaluateInvocation(request)).resolves.toMatchObject({ outcome: "AUTHORIZED" });
    await execute(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId", "reasonCode"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, "policy-stale-legitimate-replacement", input.proposal.policyKey, input.proposal.nextRevision, input.proposal.expectedPredecessorPolicyVersionId, input.proposal.recordKind, input.proposal.normativeActionKey, input.proposal.authorityMode, input.proposal.scopeSchemaKey, input.proposal.scopeSchemaVersion, input.proposal.definitionJson, input.proposal.contentSha256, input.proposal.priorDecisionDisposition, input.proposal.governanceDecisionId, input.proposal.reasonCode);
    await expect(writer.commitGovernedPolicyVersion(input)).resolves.toMatchObject({ status: "DENIED" });
    expect(await count("AuthorityInvocation", '"invocationKey" = ?', input.invocation.invocationKey)).toBe(0);
    expect(await count("AuthorityPolicyVersion", '"id" = ?', input.proposal.id)).toBe(0);
  });

  it("rejects policy commit after the eligibility ruleset becomes obsolete", async () => {
    const input = await setupPolicy("eligibility-obsolete");
    const rulesSubject = {
      registryVersion: "registry/v1", subjectType: "ELIGIBILITY_RULESET_FAMILY_DESCRIPTOR", subjectId: "rules-governance", versionKind: "EXACT_VERSION" as const, versionToken: "rules-governance-1",
    };
    await insertSubject("subject-rules-governance", rulesSubject);
    await insertGovernanceDecision({ id: "decision-replace-governance-rules", subjectRefId: "subject-rules-governance", familyKind: "ELIGIBILITY_RULESET", familyKey: "rules-governance", expectedPredecessorId: "rules-governance-1", nextRevision: 2, recordKind: "RULESET", contentSha256: sha("b") });
    await execute(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" (
  "id", "ruleSetKey", "revision", "predecessorRuleSetVersionId", "recordKind", "contractCatalogRevision", "contentSha256", "governanceDecisionId"
) VALUES ('rules-governance-2', 'rules-governance', 2, 'rules-governance-1', 'RULESET', 'catalog/v1', ?, 'decision-replace-governance-rules')
`, sha("b"));
    await expect(writer.commitGovernedPolicyVersion(input)).resolves.toMatchObject({ status: "UNRESOLVED" });
    expect(await count("AuthorityInvocation", '"invocationKey" = ?', input.invocation.invocationKey)).toBe(0);
  });

  it("rejects policy commit after its governance policy basis is invalidated", async () => {
    const policyBasis = await setupPolicy("basis-invalidated");
    const governanceSubject = {
      registryVersion: "registry/v1", subjectType: "POLICY_FAMILY_DESCRIPTOR", subjectId: "policy.governance", versionKind: "EXACT_VERSION" as const, versionToken: "policy-governance-1",
    };
    await insertSubject("subject-policy-governance", governanceSubject);
    await insertGovernanceDecision({ id: "decision-revoke-governance", subjectRefId: "subject-policy-governance", familyKind: "POLICY", familyKey: "policy.governance", expectedPredecessorId: "policy-governance-1", nextRevision: 2, recordKind: "REVOCATION", contentSha256: sha("c") });
    await execute(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId", "reasonCode"
) VALUES ('policy-governance-revoked', 'policy.governance', 2, 'policy-governance-1', 'REVOCATION', ?, 'HUMAN_GATED', 'scope/v1', '1', NULL, ?, 'INVALIDATE', 'decision-revoke-governance', 'TEST_REVOCATION')
`, authorityGovernanceActionKey, sha("c"));
    await expect(writer.commitGovernedPolicyVersion(policyBasis)).resolves.toMatchObject({ status: "DENIED" });
    expect(await count("AuthorityInvocation", '"invocationKey" = ?', policyBasis.invocation.invocationKey)).toBe(0);
  });
});
