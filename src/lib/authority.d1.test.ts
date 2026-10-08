import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  canonicalizeAuthoritySubject,
  createAuthorityEvaluator,
  createTr03AuthoritySubjectResolverRegistry,
  prepareAuthorizedAuthorityInvocation,
  type AuthorityD1Database,
  type AuthorityInvocationRequest,
} from "./authority";

const repositoryRoot = process.cwd();
const wranglerEntry = join(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const defaultDatabaseName = "standloud-crm-prod";
const localDatabaseId = "5e3373f0-79c0-452b-8f51-abfcb23b2931";
const timestamp = "2026-10-07T00:00:00.000Z";
const sha = (character: string) => character.repeat(64);

type LocalD1PreparedStatement = {
  bind(...values: unknown[]): LocalD1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

type LocalD1Database = AuthorityD1Database & {
  prepare(query: string): LocalD1PreparedStatement;
  batch(statements: readonly LocalD1PreparedStatement[]): Promise<unknown[]>;
};

let temporaryRoot: string;
let cleanPersistPath: string;
let miniflare: Miniflare;
let database: LocalD1Database;
let evaluator: ReturnType<typeof createAuthorityEvaluator>;

const policyAutoSubject = {
  registryVersion: "registry/v1",
  subjectType: "POLICY_FAMILY_DESCRIPTOR",
  subjectId: "policy.auto",
  versionKind: "EXACT_VERSION" as const,
  versionToken: "policy-auto-1",
};

const policyHumanSubject = {
  registryVersion: "registry/v1",
  subjectType: "POLICY_FAMILY_DESCRIPTOR",
  subjectId: "policy.human",
  versionKind: "EXACT_VERSION" as const,
  versionToken: "policy-human-1",
};

const policyDelegatedSubject = {
  registryVersion: "registry/v1",
  subjectType: "POLICY_FAMILY_DESCRIPTOR",
  subjectId: "policy.delegated",
  versionKind: "EXACT_VERSION" as const,
  versionToken: "policy-delegated-1",
};

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

async function insertSubject(id: string, descriptorInput: typeof policyAutoSubject) {
  const descriptor = await canonicalizeAuthoritySubject(descriptorInput);
  await execute(`
INSERT INTO "AuthoritySubjectRef" (
  "id", "registryVersion", "subjectType", "subjectId", "versionKind", "versionToken", "descriptorFormat", "canonicalKey", "descriptorSha256"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`, id, descriptor.registryVersion, descriptor.subjectType, descriptor.subjectId, descriptor.versionKind, descriptor.versionToken, descriptor.format, descriptor.canonicalKey, descriptor.descriptorSha256);
  return descriptor;
}

async function insertPolicy(input: Readonly<{
  id: string;
  policyKey: string;
  normativeActionKey: string;
  authorityMode: "POLICY_GOVERNED" | "HUMAN_GATED" | "DELEGATED";
  contentSha256: string;
}>) {
  await execute(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "bootstrapKey"
) VALUES (?, ?, 1, 'POLICY', ?, ?, 'scope/v1', '1', '{}', ?, 'PRESERVE', 'AUTHORITY_BOOTSTRAP_V1')
`, input.id, input.policyKey, input.normativeActionKey, input.authorityMode, input.contentSha256);
}

function autoRequest(overrides: Partial<AuthorityInvocationRequest> = {}): AuthorityInvocationRequest {
  return {
    invocationKey: "invoke:auto",
    normativeActionKey: "AUTO_ACTION",
    capabilityKey: "cap.auto",
    executorActorId: "actor-system",
    executorType: "DETERMINISTIC_SYSTEM",
    subject: policyAutoSubject,
    requestedAuthorityMode: "POLICY_GOVERNED",
    policyKey: "policy.auto",
    ruleSetKey: "rules-main",
    evaluatedAt: timestamp,
    ...overrides,
  };
}

describe("TR-03C real disposable D1 authority evaluation", () => {
  beforeAll(async () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), "standloud-tr03c-"));
    cleanPersistPath = join(temporaryRoot, "persist");
    runWrangler(["d1", "migrations", "apply", defaultDatabaseName, "--local", "--persist-to", cleanPersistPath]);
    miniflare = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: "",
      resourcePersistencePath: join(cleanPersistPath, "v3"),
      d1Databases: { DATABASE: localDatabaseId },
    }));
    database = await miniflare.getD1Database("DATABASE") as unknown as LocalD1Database;

    await execute(`INSERT INTO "Actor" ("id", "category") VALUES ('actor-principal', 'HUMAN'), ('actor-human', 'HUMAN'), ('actor-system', 'SYSTEM'), ('actor-external', 'EXTERNAL_PARTY')`);
    await execute(`
INSERT INTO "AuthorityBootstrapReceipt" ("bootstrapKey", "manifestVersion", "manifestSha256", "manifestSourceRef", "principalActorId", "provisionedAt")
VALUES ('AUTHORITY_BOOTSTRAP_V1', 'tr03c-manifest/v1', ?, 'disposable-test-only', 'actor-principal', ?)
`, sha("a"), timestamp);
    await insertPolicy({ id: "policy-governance-1", policyKey: "policy.governance", normativeActionKey: "AUTHORITY_POLICY_GOVERNANCE", authorityMode: "HUMAN_GATED", contentSha256: sha("b") });
    await insertPolicy({ id: "policy-auto-1", policyKey: "policy.auto", normativeActionKey: "AUTO_ACTION", authorityMode: "POLICY_GOVERNED", contentSha256: sha("c") });
    await insertPolicy({ id: "policy-human-1", policyKey: "policy.human", normativeActionKey: "HUMAN_ACTION", authorityMode: "HUMAN_GATED", contentSha256: sha("d") });
    await insertPolicy({ id: "policy-delegated-1", policyKey: "policy.delegated", normativeActionKey: "DELEGATED_ACTION", authorityMode: "DELEGATED", contentSha256: sha("e") });
    await insertSubject("subject-policy-auto", policyAutoSubject);
    await insertSubject("subject-policy-human", policyHumanSubject);
    await insertSubject("subject-policy-delegated", policyDelegatedSubject);

    await execute(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" ("id", "ruleSetKey", "revision", "recordKind", "contractCatalogRevision", "contentSha256", "bootstrapKey")
VALUES ('rules-main-1', 'rules-main', 1, 'RULESET', 'catalog/v1', ?, 'AUTHORITY_BOOTSTRAP_V1')
`, sha("f"));
    await execute(`
INSERT INTO "ExecutorEligibilityRule" ("id", "ruleSetVersionId", "capabilityKey", "contractVariantKey", "executorType", "verdict", "ruleSha256") VALUES
  ('rule-auto', 'rules-main-1', 'cap.auto', 'DEFAULT', 'DETERMINISTIC_SYSTEM', 'ELIGIBLE', ?),
  ('rule-human', 'rules-main-1', 'cap.human', 'DEFAULT', 'HUMAN_EXECUTOR', 'ELIGIBLE', ?),
  ('rule-delegated', 'rules-main-1', 'cap.delegated', 'DEFAULT', 'DETERMINISTIC_SYSTEM', 'ELIGIBLE', ?)
`, sha("1"), sha("2"), sha("3"));
    await execute(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt")
VALUES ('decision-human-1', 'request:human:1', 'HUMAN_ACTION', 'APPROVED', 'actor-human', 'subject-policy-auto', 'policy-human-1', ?)
`, timestamp);
    await execute(`
INSERT INTO "DelegationGrant" (
  "id", "grantRequestKey", "grantedPolicyVersionId", "delegatorActorId", "delegateActorId", "scopeRootSubjectRefId", "scopeSchemaKey", "validFrom", "validUntil", "grantingPolicyVersionId"
) VALUES ('grant-delegated-1', 'grant:delegated:1', 'policy-delegated-1', 'actor-principal', 'actor-system', 'subject-policy-delegated', 'scope/v1', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'policy-governance-1')
`);
    evaluator = createAuthorityEvaluator(database);
  }, 120_000);

  afterAll(async () => {
    await miniflare?.dispose();
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("registers only TR-03-owned family descriptors and verifies exact family/version against D1", async () => {
    const registry = createTr03AuthoritySubjectResolverRegistry(database);
    const matching = await canonicalizeAuthoritySubject(policyAutoSubject);
    const mismatching = await canonicalizeAuthoritySubject({ ...policyAutoSubject, subjectId: "policy.other" });
    const unknown = await canonicalizeAuthoritySubject({ registryVersion: "registry/v1", subjectType: "BUSINESS_CASE", subjectId: "case-1", versionKind: "NON_VERSIONED" });
    await expect(registry.resolve(matching)).resolves.toEqual({ status: "MATCH" });
    await expect(registry.resolve(mismatching)).resolves.toMatchObject({ status: "MISMATCH" });
    await expect(registry.resolve(unknown)).resolves.toEqual({ status: "UNRESOLVED", reasonCode: "SUBJECT_TYPE_UNREGISTERED" });
  });

  it("authorizes only a current policy-governed request with eligible internal executor", async () => {
    await expect(evaluator.evaluateInvocation(autoRequest())).resolves.toMatchObject({
      outcome: "AUTHORIZED",
      context: { policyVersionId: "policy-auto-1", eligibilityRuleSetVersionId: "rules-main-1", eligibilityRuleId: "rule-auto", decisionId: null, delegationGrantId: null },
    });
    await expect(evaluator.evaluateInvocation(autoRequest({ invocationKey: "invoke:external", executorActorId: "actor-external" }))).resolves.toMatchObject({ outcome: "DENIED", reasonCode: "EXECUTOR_EXTERNAL_PARTY" });
    await expect(evaluator.evaluateInvocation(autoRequest({ invocationKey: "invoke:unknown-subject", subject: { registryVersion: "registry/v1", subjectType: "BUSINESS_CASE", subjectId: "case-1", versionKind: "NON_VERSIONED" } }))).resolves.toMatchObject({ outcome: "UNRESOLVED", reasonCode: "SUBJECT_TYPE_UNREGISTERED" });
  });

  it("resolves human-gated authority with exact human Decision and rejects subject mismatch", async () => {
    const request = autoRequest({
      invocationKey: "invoke:human",
      normativeActionKey: "HUMAN_ACTION",
      capabilityKey: "cap.human",
      executorActorId: "actor-human",
      executorType: "HUMAN_EXECUTOR",
      requestedAuthorityMode: "HUMAN_GATED",
      policyKey: "policy.human",
      decisionId: "decision-human-1",
    });
    await expect(evaluator.evaluateInvocation(request)).resolves.toMatchObject({ outcome: "AUTHORIZED", context: { decisionId: "decision-human-1", policyVersionId: "policy-human-1" } });
    await expect(evaluator.evaluateInvocation({ ...request, invocationKey: "invoke:human-wrong-subject", subject: policyHumanSubject })).resolves.toMatchObject({ outcome: "DENIED", reasonCode: "HUMAN_DECISION_MISMATCH" });
    await execute(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt")
VALUES ('decision-human-system', 'request:human:system', 'HUMAN_ACTION', 'APPROVED', 'actor-system', 'subject-policy-auto', 'policy-human-1', ?)
`, timestamp);
    await expect(evaluator.evaluateInvocation({ ...request, invocationKey: "invoke:human-system-decision", decisionId: "decision-human-system" })).resolves.toMatchObject({ outcome: "DENIED", reasonCode: "DECISION_ACTOR_NOT_HUMAN" });
  });

  it("resolves delegation only within its exact scope and validity window", async () => {
    const request = autoRequest({
      invocationKey: "invoke:delegated",
      normativeActionKey: "DELEGATED_ACTION",
      capabilityKey: "cap.delegated",
      requestedAuthorityMode: "DELEGATED",
      policyKey: "policy.delegated",
      delegationGrantId: "grant-delegated-1",
      caseOrScopeSubject: policyDelegatedSubject,
    });
    await expect(evaluator.evaluateInvocation(request)).resolves.toMatchObject({ outcome: "AUTHORIZED", context: { delegationGrantId: "grant-delegated-1", policyVersionId: "policy-delegated-1" } });
    await expect(evaluator.evaluateInvocation({ ...request, invocationKey: "invoke:delegated-expired", evaluatedAt: "2026-11-01T00:00:00.000Z" })).resolves.toMatchObject({ outcome: "DENIED", reasonCode: "DELEGATION_EXPIRED" });
    await execute(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt")
VALUES ('decision-revoke-grant', 'request:revoke-grant', 'AUTHORITY_POLICY_GOVERNANCE', 'APPROVED', 'actor-principal', 'subject-policy-auto', 'policy-governance-1', ?)
`, timestamp);
    await execute(`INSERT INTO "AuthorityRelation" ("id", "effectingDecisionId", "relationKind", "targetDelegationGrantId") VALUES ('relation-revoke-grant', 'decision-revoke-grant', 'REVOKES', 'grant-delegated-1')`);
    await expect(evaluator.evaluateInvocation({ ...request, invocationKey: "invoke:delegated-revoked" })).resolves.toMatchObject({ outcome: "DENIED", reasonCode: "DELEGATION_RELATION_INVALIDATED" });
  });

  it("denies a human Decision after an immutable revocation relation", async () => {
    await execute(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt")
VALUES ('decision-revoke-human', 'request:revoke-human', 'AUTHORITY_POLICY_GOVERNANCE', 'APPROVED', 'actor-principal', 'subject-policy-auto', 'policy-governance-1', ?)
`, timestamp);
    await execute(`INSERT INTO "AuthorityRelation" ("id", "effectingDecisionId", "relationKind", "targetDecisionId") VALUES ('relation-revoke-human', 'decision-revoke-human', 'REVOKES', 'decision-human-1')`);
    await expect(evaluator.evaluateInvocation(autoRequest({
      invocationKey: "invoke:human-revoked",
      normativeActionKey: "HUMAN_ACTION",
      capabilityKey: "cap.human",
      executorActorId: "actor-human",
      executorType: "HUMAN_EXECUTOR",
      requestedAuthorityMode: "HUMAN_GATED",
      policyKey: "policy.human",
      decisionId: "decision-human-1",
    }))).resolves.toMatchObject({ outcome: "DENIED", reasonCode: "DECISION_RELATION_INVALIDATED" });
  });

  it("reconciles immutable invocation context without claiming a consequence", async () => {
    const evaluation = await evaluator.evaluateInvocation(autoRequest({ invocationKey: "reconcile-key" }));
    expect(evaluation.outcome).toBe("AUTHORIZED");
    if (evaluation.outcome !== "AUTHORIZED") throw new Error("Expected authorization fixture.");
    await execute(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-reconcile-1', 'reconcile-key', ?, 'AUTO_ACTION', 'cap.auto', 'actor-system', 'DETERMINISTIC_SYSTEM', 'subject-policy-auto', 'policy-auto-1', 'rules-main-1', 'rule-auto', 'AUTHORIZED', ?, ?)
`, evaluation.canonicalRequestSha256, sha("4"), timestamp);
    await expect(evaluator.reconcileAuthorityInvocation("missing-key", evaluation.canonicalRequestSha256)).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(evaluator.reconcileAuthorityInvocation("reconcile-key", evaluation.canonicalRequestSha256)).resolves.toMatchObject({
      status: "MATCHED",
      consequenceProven: false,
      invocation: { id: "invocation-reconcile-1", invocationKey: "reconcile-key" },
    });
    await expect(evaluator.reconcileAuthorityInvocation("reconcile-key", sha("5"))).resolves.toMatchObject({ status: "DIGEST_MISMATCH", invocationId: "invocation-reconcile-1" });
    expect("commitAuthorityInvocation" in evaluator).toBe(false);
  });

  it("keeps evaluator and D1 aligned across PRESERVE, then rejects an INVALIDATE successor", async () => {
    await execute(`
INSERT INTO "Decision" (
  "id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt"
) VALUES ('decision-human-preserve', 'request:human:preserve', 'HUMAN_ACTION', 'APPROVED', 'actor-human', 'subject-policy-auto', 'policy-human-1', ?)
`, timestamp);
    const preserveContent = sha("6");
    await execute(`
INSERT INTO "Decision" (
  "id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "conditionsSchemaKey", "conditionsJson", "conditionsSha256", "issuedAt"
) VALUES ('decision-policy-human-preserve', 'request:policy:human:preserve', 'AUTHORITY_POLICY_GOVERNANCE', 'APPROVED', 'actor-human', 'subject-policy-human', 'policy-governance-1', 'authority-kernel-governance-proposal/v1', ?, ?, ?)
`, JSON.stringify({ familyKind: "POLICY", familyKey: "policy.human", expectedPredecessorId: "policy-human-1", nextRevision: 2, recordKind: "POLICY", proposedContentSha256: preserveContent }), sha("7"), timestamp);
    await execute(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId"
) VALUES ('policy-human-2-preserved', 'policy.human', 2, 'policy-human-1', 'POLICY', 'HUMAN_ACTION', 'HUMAN_GATED', 'scope/v1', '1', '{}', ?, 'PRESERVE', 'decision-policy-human-preserve')
`, preserveContent);

    const request = autoRequest({
      invocationKey: "invoke:human:preserve",
      normativeActionKey: "HUMAN_ACTION",
      capabilityKey: "cap.human",
      executorActorId: "actor-human",
      executorType: "HUMAN_EXECUTOR",
      requestedAuthorityMode: "HUMAN_GATED",
      policyKey: "policy.human",
      decisionId: "decision-human-preserve",
    });
    const evaluation = await evaluator.evaluateInvocation(request);
    expect(evaluation).toMatchObject({ outcome: "AUTHORIZED", context: { policyVersionId: "policy-human-2-preserved", decisionId: "decision-human-preserve" } });
    if (evaluation.outcome !== "AUTHORIZED") throw new Error("Expected PRESERVE authorization fixture.");
    const prepared = await prepareAuthorizedAuthorityInvocation(request, evaluation);
    await execute(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "contractVariantKey", "executorActorId", "executorType", "subjectRefId", "caseSubjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "decisionId", "delegationGrantId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, "invocation-human-preserve", prepared.fields.invocationKey, prepared.fields.canonicalRequestSha256, prepared.fields.normativeActionKey, prepared.fields.capabilityKey, prepared.fields.contractVariantKey, prepared.fields.executorActorId, prepared.fields.executorType, prepared.fields.subjectRefId, prepared.fields.caseSubjectRefId, prepared.fields.policyVersionId, prepared.fields.eligibilityRuleSetVersionId, prepared.fields.eligibilityRuleId, prepared.fields.decisionId, prepared.fields.delegationGrantId, prepared.fields.outcome, prepared.fields.lineageSha256, prepared.fields.evaluatedAt);

    const policyHumanV2Subject = { ...policyHumanSubject, versionToken: "policy-human-2-preserved" };
    await insertSubject("subject-policy-human-2-preserved", policyHumanV2Subject);
    const invalidateContent = sha("8");
    await execute(`
INSERT INTO "Decision" (
  "id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "conditionsSchemaKey", "conditionsJson", "conditionsSha256", "issuedAt"
) VALUES ('decision-policy-human-invalidate', 'request:policy:human:invalidate', 'AUTHORITY_POLICY_GOVERNANCE', 'APPROVED', 'actor-human', 'subject-policy-human-2-preserved', 'policy-governance-1', 'authority-kernel-governance-proposal/v1', ?, ?, ?)
`, JSON.stringify({ familyKind: "POLICY", familyKey: "policy.human", expectedPredecessorId: "policy-human-2-preserved", nextRevision: 3, recordKind: "REVOCATION", proposedContentSha256: invalidateContent }), sha("9"), timestamp);
    await execute(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId", "reasonCode"
) VALUES ('policy-human-3-invalidated', 'policy.human', 3, 'policy-human-2-preserved', 'REVOCATION', 'HUMAN_ACTION', 'HUMAN_GATED', 'scope/v1', '1', NULL, ?, 'INVALIDATE', 'decision-policy-human-invalidate', 'TEST_INVALIDATE')
`, invalidateContent);
    await expect(evaluator.evaluateInvocation({ ...request, invocationKey: "invoke:human:invalidated" })).resolves.toMatchObject({ outcome: "DENIED", reasonCode: "POLICY_DISABLED_OR_REVOKED" });
    await expect(execute(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "contractVariantKey", "executorActorId", "executorType", "subjectRefId", "caseSubjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "decisionId", "delegationGrantId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, "invocation-human-invalidated", "invoke:human:invalidated", prepared.fields.canonicalRequestSha256, prepared.fields.normativeActionKey, prepared.fields.capabilityKey, prepared.fields.contractVariantKey, prepared.fields.executorActorId, prepared.fields.executorType, prepared.fields.subjectRefId, prepared.fields.caseSubjectRefId, "policy-human-3-invalidated", prepared.fields.eligibilityRuleSetVersionId, prepared.fields.eligibilityRuleId, prepared.fields.decisionId, prepared.fields.delegationGrantId, prepared.fields.outcome, prepared.fields.lineageSha256, prepared.fields.evaluatedAt)).rejects.toThrow(/AUTHORITY_INVOCATION_HUMAN_GATED_MISMATCH/);
  });
});
