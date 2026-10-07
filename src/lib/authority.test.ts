import { describe, expect, it } from "vitest";
import {
  authoritySubjectDescriptorFormat,
  canonicalizeAuthoritySubject,
  computeCanonicalAuthorityRequestSha256,
  createAuthoritySubjectResolverRegistry,
  evaluateBoundedAuthorityConditions,
  evaluateExecutorEligibility,
  evaluatePriorDecisionApplicability,
  governanceProposalConditionsSchema,
  prepareAuthorizedAuthorityInvocation,
  resolveDecisionAuthorityRelation,
  resolveDelegationAuthorityRelation,
  resolvePolicyHead,
  type AuthorityPolicyVersionRecord,
  type ExecutorEligibilityRuleRecord,
  type ExecutorEligibilityRuleSetVersionRecord,
} from "./authority";

const sha = (character: string) => character.repeat(64);

function policy(overrides: Partial<AuthorityPolicyVersionRecord> = {}): AuthorityPolicyVersionRecord {
  return {
    id: "policy-1",
    policyKey: "policy.example",
    revision: 1,
    predecessorPolicyVersionId: null,
    recordKind: "POLICY",
    normativeActionKey: "ACTION",
    authorityMode: "HUMAN_GATED",
    scopeSchemaKey: "scope/v1",
    scopeSchemaVersion: "1",
    definitionJson: "{}",
    contentSha256: sha("a"),
    priorDecisionDisposition: "PRESERVE",
    ...overrides,
  };
}

function ruleSet(overrides: Partial<ExecutorEligibilityRuleSetVersionRecord> = {}): ExecutorEligibilityRuleSetVersionRecord {
  return {
    id: "rules-1",
    ruleSetKey: "rules.example",
    revision: 1,
    predecessorRuleSetVersionId: null,
    recordKind: "RULESET",
    contractCatalogRevision: "catalog/v1",
    contentSha256: sha("b"),
    ...overrides,
  };
}

function rule(overrides: Partial<ExecutorEligibilityRuleRecord> = {}): ExecutorEligibilityRuleRecord {
  return {
    id: "rule-1",
    ruleSetVersionId: "rules-1",
    capabilityKey: "capability.example",
    contractVariantKey: "DEFAULT",
    executorType: "HUMAN_EXECUTOR",
    verdict: "ELIGIBLE",
    conditionsSchemaKey: null,
    conditionsJson: null,
    ...overrides,
  };
}

describe("TR-03C authority primitives", () => {
  it("canonicalizes subject descriptors deterministically and makes version semantics part of identity", async () => {
    const base = {
      registryVersion: "registry/v1",
      subjectType: "POLICY_FAMILY_DESCRIPTOR",
      subjectId: "policy.example",
      versionKind: "EXACT_VERSION" as const,
      versionToken: "policy-1",
    };
    const first = await canonicalizeAuthoritySubject(base);
    const second = await canonicalizeAuthoritySubject({ ...base });
    const differentVersion = await canonicalizeAuthoritySubject({ ...base, versionToken: "policy-2" });
    expect(first.format).toBe(authoritySubjectDescriptorFormat);
    expect(first).toEqual(second);
    expect(first.canonicalKey).not.toBe(differentVersion.canonicalKey);
    expect(first.descriptorSha256).not.toBe(differentVersion.descriptorSha256);
    await expect(canonicalizeAuthoritySubject({ ...base, versionKind: "NON_VERSIONED", versionToken: "forbidden" })).rejects.toThrow("AUTHORITY_SUBJECT_INVALID");
    await expect(canonicalizeAuthoritySubject({ ...base, versionToken: null })).rejects.toThrow("AUTHORITY_SUBJECT_INVALID");
  });

  it("fails closed for an unregistered subject type and delegates exact proof to registered resolvers", async () => {
    const registry = createAuthoritySubjectResolverRegistry({
      TEST_SUBJECT: async (descriptor) => descriptor.subjectId === "match" ? { status: "MATCH" } : { status: "MISMATCH", reasonCode: "TEST_MISMATCH" },
    });
    const unknown = await canonicalizeAuthoritySubject({ registryVersion: "test/v1", subjectType: "UNREGISTERED", subjectId: "x", versionKind: "NON_VERSIONED" });
    const match = await canonicalizeAuthoritySubject({ registryVersion: "test/v1", subjectType: "TEST_SUBJECT", subjectId: "match", versionKind: "NON_VERSIONED" });
    const mismatch = await canonicalizeAuthoritySubject({ registryVersion: "test/v1", subjectType: "TEST_SUBJECT", subjectId: "no", versionKind: "NON_VERSIONED" });
    await expect(registry.resolve(unknown)).resolves.toEqual({ status: "UNRESOLVED", reasonCode: "SUBJECT_TYPE_UNREGISTERED" });
    await expect(registry.resolve(match)).resolves.toEqual({ status: "MATCH" });
    await expect(registry.resolve(mismatch)).resolves.toEqual({ status: "MISMATCH", reasonCode: "TEST_MISMATCH" });
  });

  it("resolves a structural policy head and preserves or invalidates Decision applicability without resurrection", () => {
    const preserve = [
      policy(),
      policy({ id: "policy-2", revision: 2, predecessorPolicyVersionId: "policy-1", contentSha256: sha("b") }),
    ];
    const preserveHead = resolvePolicyHead(preserve, "policy.example");
    expect(preserveHead).toMatchObject({ status: "CURRENT_POLICY", head: { id: "policy-2" } });
    expect(evaluatePriorDecisionApplicability(preserveHead, "policy-1")).toMatchObject({ status: "APPLICABLE", traversedPolicyVersionIds: ["policy-1", "policy-2"] });

    const invalidated = resolvePolicyHead([
      policy(),
      policy({ id: "policy-2", revision: 2, predecessorPolicyVersionId: "policy-1", priorDecisionDisposition: "INVALIDATE", contentSha256: sha("c") }),
      policy({ id: "policy-3", revision: 3, predecessorPolicyVersionId: "policy-2", contentSha256: sha("d") }),
    ], "policy.example");
    expect(evaluatePriorDecisionApplicability(invalidated, "policy-1")).toMatchObject({
      status: "INVALIDATED",
      firstInvalidatingPolicyVersionId: "policy-2",
      currentHeadPolicyVersionId: "policy-3",
    });

    const revokedThenResumed = resolvePolicyHead([
      policy(),
      policy({ id: "policy-revoked", revision: 2, predecessorPolicyVersionId: "policy-1", recordKind: "REVOCATION", definitionJson: null, priorDecisionDisposition: "INVALIDATE", contentSha256: sha("e") }),
      policy({ id: "policy-resumed", revision: 3, predecessorPolicyVersionId: "policy-revoked", contentSha256: sha("f") }),
    ], "policy.example");
    expect(revokedThenResumed).toMatchObject({ status: "CURRENT_POLICY", head: { id: "policy-resumed" } });
    expect(evaluatePriorDecisionApplicability(revokedThenResumed, "policy-1")).toMatchObject({
      status: "INVALIDATED",
      firstInvalidatingPolicyVersionId: "policy-revoked",
    });
  });

  it("fails closed for forks, revision discontinuity, and corrupted relation graphs", () => {
    expect(resolvePolicyHead([
      policy(),
      policy({ id: "policy-2a", revision: 2, predecessorPolicyVersionId: "policy-1", contentSha256: sha("b") }),
      policy({ id: "policy-2b", revision: 2, predecessorPolicyVersionId: "policy-1", contentSha256: sha("c") }),
    ], "policy.example")).toMatchObject({ status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_FORK" });
    expect(resolvePolicyHead([
      policy(),
      policy({ id: "policy-3", revision: 3, predecessorPolicyVersionId: "policy-1", contentSha256: sha("b") }),
    ], "policy.example")).toMatchObject({ status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_PREDECESSOR_MISMATCH" });

    const revocations = [
      { id: "revoke-a", effectingDecisionId: "new-a", relationKind: "REVOKES" as const, targetDecisionId: "decision-a", targetDelegationGrantId: null },
      { id: "revoke-b", effectingDecisionId: "new-b", relationKind: "REVOKES" as const, targetDecisionId: "decision-a", targetDelegationGrantId: null },
    ];
    expect(resolveDecisionAuthorityRelation("decision-a", revocations)).toEqual({ status: "REVOKED", relationIds: ["revoke-a", "revoke-b"] });
    expect(resolveDelegationAuthorityRelation("grant-a", [
      { id: "super-1", effectingDecisionId: "one", relationKind: "SUPERSEDES", targetDecisionId: null, targetDelegationGrantId: "grant-a" },
      { id: "super-2", effectingDecisionId: "two", relationKind: "SUPERSEDES", targetDecisionId: null, targetDelegationGrantId: "grant-a" },
    ])).toMatchObject({ status: "UNRESOLVED", reasonCode: "RELATION_MULTIPLE_SUPERSEDES" });
    expect(resolveDecisionAuthorityRelation("decision-a", [
      { id: "edge-ab", effectingDecisionId: "decision-a", relationKind: "SUPERSEDES", targetDecisionId: "decision-b", targetDelegationGrantId: null },
      { id: "edge-ba", effectingDecisionId: "decision-b", relationKind: "SUPERSEDES", targetDecisionId: "decision-a", targetDelegationGrantId: null },
    ])).toMatchObject({ status: "UNRESOLVED", reasonCode: "RELATION_SUPERSEDES_CYCLE" });
  });

  it("evaluates only the current exact eligibility cell and fails closed for disabled, missing, ineligible, and unsupported conditional rules", () => {
    const current = ruleSet();
    expect(evaluateExecutorEligibility({
      ruleSetRecords: [current],
      rules: [rule()],
      request: { ruleSetKey: "rules.example", capabilityKey: "capability.example", executorType: "HUMAN_EXECUTOR" },
    })).toEqual({ status: "ELIGIBLE", ruleSetVersionId: "rules-1", ruleId: "rule-1" });
    expect(evaluateExecutorEligibility({
      ruleSetRecords: [current],
      rules: [rule({ verdict: "INELIGIBLE" })],
      request: { ruleSetKey: "rules.example", capabilityKey: "capability.example", executorType: "HUMAN_EXECUTOR" },
    })).toMatchObject({ status: "INELIGIBLE", reasonCode: "ELIGIBILITY_RULE_INELIGIBLE" });
    expect(evaluateExecutorEligibility({
      ruleSetRecords: [current],
      rules: [rule({ verdict: "CONDITIONAL", conditionsSchemaKey: "unsupported/v1", conditionsJson: "{}" })],
      request: { ruleSetKey: "rules.example", capabilityKey: "capability.example", executorType: "HUMAN_EXECUTOR" },
    })).toMatchObject({ status: "UNRESOLVED", reasonCode: "CONDITIONS_SCHEMA_UNSUPPORTED" });
    expect(evaluateExecutorEligibility({
      ruleSetRecords: [ruleSet({ id: "rules-old" }), ruleSet({ id: "rules-disabled", revision: 2, predecessorRuleSetVersionId: "rules-old", recordKind: "DISABLED", contentSha256: sha("c") })],
      rules: [rule({ ruleSetVersionId: "rules-old" })],
      request: { ruleSetKey: "rules.example", capabilityKey: "capability.example", executorType: "HUMAN_EXECUTOR" },
    })).toMatchObject({ status: "INELIGIBLE", reasonCode: "RULESET_DISABLED" });
    expect(evaluateExecutorEligibility({
      ruleSetRecords: [current],
      rules: [],
      request: { ruleSetKey: "rules.example", capabilityKey: "capability.example", executorType: "HUMAN_EXECUTOR" },
    })).toMatchObject({ status: "UNRESOLVED", reasonCode: "ELIGIBILITY_RULE_MISSING" });
    expect(evaluateExecutorEligibility({
      ruleSetRecords: [ruleSet({ id: "rules-old" }), ruleSet({ id: "rules-current", revision: 2, predecessorRuleSetVersionId: "rules-old", contentSha256: sha("d") })],
      rules: [rule({ ruleSetVersionId: "rules-old" })],
      request: { ruleSetKey: "rules.example", capabilityKey: "capability.example", executorType: "HUMAN_EXECUTOR" },
    })).toMatchObject({ status: "UNRESOLVED", reasonCode: "ELIGIBILITY_RULE_MISSING" });
  });

  it("evaluates only the bounded governance proposal schema", () => {
    const proposal = {
      familyKind: "POLICY" as const,
      familyKey: "policy.example",
      expectedPredecessorId: "policy-1",
      nextRevision: 2,
      recordKind: "POLICY",
      proposedContentSha256: sha("a"),
    };
    expect(evaluateBoundedAuthorityConditions({ schemaKey: governanceProposalConditionsSchema, json: JSON.stringify(proposal), governanceProposal: proposal })).toEqual({ status: "MATCH" });
    expect(evaluateBoundedAuthorityConditions({ schemaKey: governanceProposalConditionsSchema, json: JSON.stringify(proposal), governanceProposal: { ...proposal, nextRevision: 3 } })).toEqual({ status: "MISMATCH" });
    expect(evaluateBoundedAuthorityConditions({ schemaKey: "unknown/v1", json: "{}" })).toMatchObject({ status: "UNRESOLVED" });
  });

  it("hashes only semantic request identity and produces a non-committable prepared invocation", async () => {
    const subject = await canonicalizeAuthoritySubject({ registryVersion: "registry/v1", subjectType: "POLICY_FAMILY_DESCRIPTOR", subjectId: "policy.example", versionKind: "EXACT_VERSION", versionToken: "policy-1" });
    const base = {
      normativeActionKey: "ACTION",
      capabilityKey: "capability.example",
      executorActorId: "actor-1",
      executorType: "HUMAN_EXECUTOR" as const,
      subjectCanonicalKey: subject.canonicalKey,
      requestedAuthorityMode: "HUMAN_GATED" as const,
      policyKey: "policy.example",
    };
    const first = await computeCanonicalAuthorityRequestSha256(base);
    const second = await computeCanonicalAuthorityRequestSha256({ ...base });
    const changed = await computeCanonicalAuthorityRequestSha256({ ...base, capabilityKey: "capability.changed" });
    expect(first).toBe(second);
    expect(first).not.toBe(changed);

    const governed = await computeCanonicalAuthorityRequestSha256({
      ...base,
      governanceConsequence: {
        familyKind: "POLICY",
        successorId: "policy-2",
        policyKey: "policy.example",
        expectedPredecessorId: "policy-1",
        nextRevision: 2,
        recordKind: "REVOCATION",
        normativeActionKey: "ACTION",
        authorityMode: "HUMAN_GATED",
        scopeSchemaKey: "scope/v1",
        scopeSchemaVersion: "1",
        definitionJson: null,
        proposedContentSha256: sha("c"),
        priorDecisionDisposition: "INVALIDATE",
        reasonCode: "REVOKED",
      },
    });
    const governedChangedReason = await computeCanonicalAuthorityRequestSha256({
      ...base,
      governanceConsequence: {
        familyKind: "POLICY",
        successorId: "policy-2",
        policyKey: "policy.example",
        expectedPredecessorId: "policy-1",
        nextRevision: 2,
        recordKind: "REVOCATION",
        normativeActionKey: "ACTION",
        authorityMode: "HUMAN_GATED",
        scopeSchemaKey: "scope/v1",
        scopeSchemaVersion: "1",
        definitionJson: null,
        proposedContentSha256: sha("c"),
        priorDecisionDisposition: "INVALIDATE",
        reasonCode: "REVOKED_DIFFERENTLY",
      },
    });
    expect(governed).not.toBe(governedChangedReason);

    const plan = await prepareAuthorizedAuthorityInvocation({
      invocationKey: "command-key-not-in-digest",
      ...base,
      ruleSetKey: "rules.example",
      subject: { registryVersion: "registry/v1", subjectType: "POLICY_FAMILY_DESCRIPTOR", subjectId: "policy.example", versionKind: "EXACT_VERSION", versionToken: "policy-1" },
      evaluatedAt: "2026-10-07T00:00:00.000Z",
    }, {
      outcome: "AUTHORIZED",
      canonicalRequestSha256: first,
      context: {
        subjectRefId: "subject-1",
        caseOrScopeSubjectRefId: null,
        policyVersionId: "policy-1",
        eligibilityRuleSetVersionId: "rules-1",
        eligibilityRuleId: "rule-1",
        decisionId: "decision-1",
        delegationGrantId: null,
      },
    });
    expect(plan).toMatchObject({ state: "PREPARED", requiresCommitTimeRevalidation: true, fields: { canonicalRequestSha256: first, outcome: "AUTHORIZED" } });
    expect("commit" in plan).toBe(false);
  });
});
