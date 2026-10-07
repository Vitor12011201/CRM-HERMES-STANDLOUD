/**
 * Runtime-neutral, read-only authority evaluation primitives.
 *
 * This module deliberately has no writer and no D1 batch surface. A prepared
 * invocation is evidence for a later phase-owned native D1 commit only; it is
 * never a durable authorization by itself.
 */

export const authoritySubjectDescriptorFormat = "authority-subject/v1";
export const authorityRequestDigestFormat = "authority-invocation-request/v1";
export const authorityLineageDigestFormat = "authority-invocation-lineage/v1";
export const governanceProposalConditionsSchema = "authority-kernel-governance-proposal/v1";

export const authoritySubjectVersionKinds = ["NON_VERSIONED", "EXACT_VERSION"] as const;
export type AuthoritySubjectVersionKind = (typeof authoritySubjectVersionKinds)[number];

export const authorityModes = ["POLICY_GOVERNED", "DELEGATED", "HUMAN_GATED"] as const;
export type AuthorityMode = (typeof authorityModes)[number];

export const executorTypes = ["HUMAN_EXECUTOR", "DETERMINISTIC_SYSTEM", "REASONING_AI", "TOOL_ENABLED_AI"] as const;
export type ExecutorType = (typeof executorTypes)[number];

export type AuthorityPreparedStatement = {
  bind(...values: unknown[]): AuthorityPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

/** Read-only subset: intentionally has no batch or mutation capability. */
export type AuthorityD1Database = {
  prepare(query: string): AuthorityPreparedStatement;
};

export type AuthoritySubjectDescriptorInput = Readonly<{
  registryVersion: string;
  subjectType: string;
  subjectId: string;
  versionKind: AuthoritySubjectVersionKind;
  versionToken?: string | null;
}>;

export type CanonicalAuthoritySubjectDescriptor = Readonly<{
  format: typeof authoritySubjectDescriptorFormat;
  registryVersion: string;
  subjectType: string;
  subjectId: string;
  versionKind: AuthoritySubjectVersionKind;
  versionToken: string | null;
  canonicalKey: string;
  descriptorSha256: string;
}>;

export type AuthoritySubjectResolution =
  | Readonly<{ status: "MATCH" }>
  | Readonly<{ status: "MISMATCH"; reasonCode?: string }>
  | Readonly<{ status: "UNRESOLVED"; reasonCode: string }>;

export type AuthoritySubjectResolver = (descriptor: CanonicalAuthoritySubjectDescriptor) => Promise<AuthoritySubjectResolution>;

export type AuthoritySubjectResolverRegistry = Readonly<{
  resolve(descriptor: CanonicalAuthoritySubjectDescriptor): Promise<AuthoritySubjectResolution>;
}>;

export type AuthorityPolicyVersionRecord = Readonly<{
  id: string;
  policyKey: string;
  revision: number;
  predecessorPolicyVersionId: string | null;
  recordKind: "POLICY" | "REVOCATION";
  normativeActionKey: string;
  authorityMode: AuthorityMode;
  scopeSchemaKey: string;
  scopeSchemaVersion: string;
  definitionJson: string | null;
  contentSha256: string;
  priorDecisionDisposition: "PRESERVE" | "INVALIDATE";
}>;

export type PolicyHeadResolution =
  | Readonly<{ status: "CURRENT_POLICY"; head: AuthorityPolicyVersionRecord; chain: readonly AuthorityPolicyVersionRecord[] }>
  | Readonly<{ status: "DISABLED_OR_REVOKED"; head: AuthorityPolicyVersionRecord; chain: readonly AuthorityPolicyVersionRecord[] }>
  | Readonly<{ status: "NOT_FOUND" }>
  | Readonly<{ status: "AMBIGUOUS_OR_CORRUPT"; reasonCode: string }>;

export type PriorDecisionApplicability =
  | Readonly<{
      status: "APPLICABLE";
      basisPolicyVersionId: string;
      currentHeadPolicyVersionId: string;
      traversedPolicyVersionIds: readonly string[];
    }>
  | Readonly<{
      status: "INVALIDATED";
      basisPolicyVersionId: string;
      currentHeadPolicyVersionId: string;
      traversedPolicyVersionIds: readonly string[];
      firstInvalidatingPolicyVersionId: string;
    }>
  | Readonly<{ status: "UNRESOLVED"; reasonCode: string }>;

export type ExecutorEligibilityRuleSetVersionRecord = Readonly<{
  id: string;
  ruleSetKey: string;
  revision: number;
  predecessorRuleSetVersionId: string | null;
  recordKind: "RULESET" | "DISABLED";
  contractCatalogRevision: string;
  contentSha256: string;
}>;

export type ExecutorEligibilityRuleRecord = Readonly<{
  id: string;
  ruleSetVersionId: string;
  capabilityKey: string;
  contractVariantKey: string;
  executorType: ExecutorType;
  verdict: "ELIGIBLE" | "CONDITIONAL" | "INELIGIBLE";
  conditionsSchemaKey: string | null;
  conditionsJson: string | null;
}>;

export type EligibilityRuleSetHeadResolution =
  | Readonly<{ status: "CURRENT_RULESET"; head: ExecutorEligibilityRuleSetVersionRecord; chain: readonly ExecutorEligibilityRuleSetVersionRecord[] }>
  | Readonly<{ status: "DISABLED"; head: ExecutorEligibilityRuleSetVersionRecord; chain: readonly ExecutorEligibilityRuleSetVersionRecord[] }>
  | Readonly<{ status: "NOT_FOUND" }>
  | Readonly<{ status: "AMBIGUOUS_OR_CORRUPT"; reasonCode: string }>;

export type GovernanceProposal = Readonly<{
  familyKind: "POLICY" | "ELIGIBILITY_RULESET";
  familyKey: string;
  expectedPredecessorId: string;
  nextRevision: number;
  recordKind: string;
  proposedContentSha256: string;
}>;

/**
 * The semantic consequence bound to a governance invocation request.  This is
 * deliberately an in-memory request descriptor only: the immutable D1 kernel
 * continues to own the durable policy/ruleset rows.
 */
export type AuthorityGovernanceConsequenceBinding =
  | Readonly<{
      familyKind: "POLICY";
      successorId: string;
      policyKey: string;
      expectedPredecessorId: string;
      nextRevision: number;
      recordKind: "POLICY" | "REVOCATION";
      normativeActionKey: string;
      authorityMode: AuthorityMode;
      scopeSchemaKey: string;
      scopeSchemaVersion: string;
      definitionJson: string | null;
      proposedContentSha256: string;
      priorDecisionDisposition: "PRESERVE" | "INVALIDATE";
      reasonCode: string | null;
    }>
  | Readonly<{
      familyKind: "ELIGIBILITY_RULESET";
      successorId: string;
      ruleSetKey: string;
      expectedPredecessorId: string;
      nextRevision: number;
      recordKind: "RULESET" | "DISABLED";
      contractCatalogRevision: string;
      proposedContentSha256: string;
      childRuleSetSha256: string;
    }>;

export type BoundedConditionResult =
  | Readonly<{ status: "MATCH" }>
  | Readonly<{ status: "MISMATCH" }>
  | Readonly<{ status: "UNRESOLVED"; reasonCode: string }>;

export type ExecutorEligibilityInput = Readonly<{
  ruleSetKey: string;
  capabilityKey: string;
  contractVariantKey?: string | null;
  executorType: ExecutorType;
  governanceProposal?: GovernanceProposal;
}>;

export type ExecutorEligibilityResult =
  | Readonly<{ status: "ELIGIBLE"; ruleSetVersionId: string; ruleId: string }>
  | Readonly<{ status: "CONDITIONALLY_ELIGIBLE"; ruleSetVersionId: string; ruleId: string }>
  | Readonly<{ status: "INELIGIBLE"; reasonCode: string; ruleSetVersionId?: string; ruleId?: string }>
  | Readonly<{ status: "UNRESOLVED"; reasonCode: string }>;

export type AuthorityRelationRecord = Readonly<{
  id: string;
  effectingDecisionId: string;
  relationKind: "SUPERSEDES" | "REVOKES";
  targetDecisionId: string | null;
  targetDelegationGrantId: string | null;
}>;

export type AuthorityRelationResolution =
  | Readonly<{ status: "ACTIVE"; relationIds: readonly string[] }>
  | Readonly<{ status: "REVOKED"; relationIds: readonly string[] }>
  | Readonly<{ status: "SUPERSEDED"; relationIds: readonly string[] }>
  | Readonly<{ status: "UNRESOLVED"; reasonCode: string }>;

export type AuthorityActorRecord = Readonly<{ id: string; category: string }>;

export type AuthorityDecisionRecord = Readonly<{
  id: string;
  normativeActionKey: string;
  decidingActorId: string;
  subjectRefId: string;
  scopeRootSubjectRefId: string | null;
  basisPolicyVersionId: string;
  basisDelegationGrantId: string | null;
  conditionsSchemaKey: string | null;
  conditionsJson: string | null;
}>;

export type AuthorityDelegationGrantRecord = Readonly<{
  id: string;
  grantedPolicyVersionId: string;
  delegatorActorId: string | null;
  delegateActorId: string;
  scopeRootSubjectRefId: string;
  scopeSchemaKey: string;
  scopeJson: string | null;
  validFrom: string;
  validUntil: string | null;
  grantingPolicyVersionId: string | null;
  grantingDecisionId: string | null;
}>;

export type AuthorityInvocationRequest = Readonly<{
  invocationKey: string;
  normativeActionKey: string;
  capabilityKey: string;
  contractVariantKey?: string | null;
  executorActorId: string;
  executorType: ExecutorType;
  subject: AuthoritySubjectDescriptorInput;
  caseOrScopeSubject?: AuthoritySubjectDescriptorInput | null;
  requestedAuthorityMode: AuthorityMode;
  policyKey: string;
  ruleSetKey: string;
  decisionId?: string | null;
  delegationGrantId?: string | null;
  evaluatedAt: string;
  requestedConsequenceDescriptorKey?: string | null;
  requestedConsequenceSchemaKey?: string | null;
  governanceProposal?: GovernanceProposal;
  governanceConsequence?: AuthorityGovernanceConsequenceBinding;
}>;

export type AuthorizedAuthorityContext = Readonly<{
  subjectRefId: string;
  caseOrScopeSubjectRefId: string | null;
  policyVersionId: string;
  eligibilityRuleSetVersionId: string;
  eligibilityRuleId: string;
  decisionId: string | null;
  delegationGrantId: string | null;
}>;

export type InvocationAuthorityEvaluation =
  | Readonly<{ outcome: "AUTHORIZED"; context: AuthorizedAuthorityContext; canonicalRequestSha256: string }>
  | Readonly<{ outcome: "DENIED"; reasonCode: string; canonicalRequestSha256?: string }>
  | Readonly<{ outcome: "UNRESOLVED"; reasonCode: string; canonicalRequestSha256?: string }>;

export type PersistedAuthorityInvocation = Readonly<{
  id: string;
  invocationKey: string;
  canonicalRequestSha256: string;
  normativeActionKey: string;
  capabilityKey: string;
  contractVariantKey: string | null;
  executorActorId: string;
  executorType: ExecutorType;
  subjectRefId: string;
  caseSubjectRefId: string | null;
  policyVersionId: string;
  eligibilityRuleSetVersionId: string;
  eligibilityRuleId: string;
  decisionId: string | null;
  delegationGrantId: string | null;
  outcome: "AUTHORIZED";
  lineageSha256: string;
  evaluatedAt: string;
  createdAt: string;
}>;

export type AuthorityInvocationReconciliation =
  | Readonly<{ status: "NOT_FOUND" }>
  | Readonly<{ status: "MATCHED"; invocation: PersistedAuthorityInvocation; consequenceProven: false }>
  | Readonly<{ status: "DIGEST_MISMATCH"; invocationId: string; persistedCanonicalRequestSha256: string }>
  | Readonly<{ status: "CORRUPT"; reasonCode: string }>;

export type PreparedAuthorityInvocation = Readonly<{
  state: "PREPARED";
  requiresCommitTimeRevalidation: true;
  fields: Readonly<{
    invocationKey: string;
    canonicalRequestSha256: string;
    normativeActionKey: string;
    capabilityKey: string;
    contractVariantKey: string | null;
    executorActorId: string;
    executorType: ExecutorType;
    subjectRefId: string;
    caseSubjectRefId: string | null;
    policyVersionId: string;
    eligibilityRuleSetVersionId: string;
    eligibilityRuleId: string;
    decisionId: string | null;
    delegationGrantId: string | null;
    outcome: "AUTHORIZED";
    lineageSha256: string;
    evaluatedAt: string;
  }>;
}>;

const sha256Pattern = /^[a-f0-9]{64}$/;
const maxFamilyRows = 512;

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function optionalText(value: unknown): value is string | null {
  return value === null || isNonEmptyText(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function sameOptional(left: string | null, right: string | null) {
  return left === right;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!isNonEmptyText(value)) throw new Error("AUTHORITY_INVALID_TEXT");
  return value;
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && sha256Pattern.test(value);
}

function normalizeGovernanceConsequence(
  input: AuthorityGovernanceConsequenceBinding | undefined,
): Record<string, unknown> | null {
  if (input === undefined) return null;
  if (!isNonEmptyText(input.successorId)
    || !isNonEmptyText(input.expectedPredecessorId)
    || !isPositiveInteger(input.nextRevision)
    || !validSha256(input.proposedContentSha256)) {
    throw new Error("AUTHORITY_GOVERNANCE_CONSEQUENCE_INVALID");
  }
  if (input.familyKind === "POLICY") {
    if (!isNonEmptyText(input.policyKey)
      || (input.recordKind !== "POLICY" && input.recordKind !== "REVOCATION")
      || !isNonEmptyText(input.normativeActionKey)
      || !isOneOf(input.authorityMode, authorityModes)
      || !isNonEmptyText(input.scopeSchemaKey)
      || !isNonEmptyText(input.scopeSchemaVersion)
      || !optionalText(input.definitionJson)
      || (input.priorDecisionDisposition !== "PRESERVE" && input.priorDecisionDisposition !== "INVALIDATE")
      || !optionalText(input.reasonCode)) {
      throw new Error("AUTHORITY_GOVERNANCE_CONSEQUENCE_INVALID");
    }
    if ((input.recordKind === "POLICY" && (input.definitionJson === null || input.reasonCode !== null))
      || (input.recordKind === "REVOCATION" && (input.definitionJson !== null || input.priorDecisionDisposition !== "INVALIDATE" || input.reasonCode === null))) {
      throw new Error("AUTHORITY_GOVERNANCE_CONSEQUENCE_INVALID");
    }
    return {
      familyKind: input.familyKind,
      successorId: input.successorId,
      policyKey: input.policyKey,
      expectedPredecessorId: input.expectedPredecessorId,
      nextRevision: input.nextRevision,
      recordKind: input.recordKind,
      normativeActionKey: input.normativeActionKey,
      authorityMode: input.authorityMode,
      scopeSchemaKey: input.scopeSchemaKey,
      scopeSchemaVersion: input.scopeSchemaVersion,
      definitionJson: input.definitionJson,
      proposedContentSha256: input.proposedContentSha256,
      priorDecisionDisposition: input.priorDecisionDisposition,
      reasonCode: input.reasonCode,
    };
  }
  if (input.familyKind !== "ELIGIBILITY_RULESET"
    || !isNonEmptyText(input.ruleSetKey)
    || (input.recordKind !== "RULESET" && input.recordKind !== "DISABLED")
    || !isNonEmptyText(input.contractCatalogRevision)
    || !validSha256(input.childRuleSetSha256)) {
    throw new Error("AUTHORITY_GOVERNANCE_CONSEQUENCE_INVALID");
  }
  return {
    familyKind: input.familyKind,
    successorId: input.successorId,
    ruleSetKey: input.ruleSetKey,
    expectedPredecessorId: input.expectedPredecessorId,
    nextRevision: input.nextRevision,
    recordKind: input.recordKind,
    contractCatalogRevision: input.contractCatalogRevision,
    proposedContentSha256: input.proposedContentSha256,
    childRuleSetSha256: input.childRuleSetSha256,
  };
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("AUTHORITY_INVALID_CANONICAL_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("AUTHORITY_INVALID_CANONICAL_VALUE");
    ancestors.add(value);
    const serialized = `[${value.map((entry) => canonicalJson(entry, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return serialized;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new Error("AUTHORITY_INVALID_CANONICAL_VALUE");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("AUTHORITY_INVALID_CANONICAL_VALUE");
    ancestors.add(value);
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const serialized = `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`).join(",")}}`;
    ancestors.delete(value);
    return serialized;
  }
  throw new Error("AUTHORITY_INVALID_CANONICAL_VALUE");
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("AUTHORITY_HASH_UNAVAILABLE");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

function normalizedSubjectInput(input: AuthoritySubjectDescriptorInput): Omit<CanonicalAuthoritySubjectDescriptor, "canonicalKey" | "descriptorSha256" | "format"> {
  if (!isNonEmptyText(input.registryVersion) || !isNonEmptyText(input.subjectType) || !isNonEmptyText(input.subjectId)) {
    throw new Error("AUTHORITY_SUBJECT_INVALID");
  }
  if (!isOneOf(input.versionKind, authoritySubjectVersionKinds)) throw new Error("AUTHORITY_SUBJECT_INVALID");
  const versionToken = normalizeOptionalText(input.versionToken);
  if (input.versionKind === "NON_VERSIONED" && versionToken !== null) throw new Error("AUTHORITY_SUBJECT_INVALID");
  if (input.versionKind === "EXACT_VERSION" && versionToken === null) throw new Error("AUTHORITY_SUBJECT_INVALID");
  return {
    registryVersion: input.registryVersion,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    versionKind: input.versionKind,
    versionToken,
  };
}

/** Canonicalizes only declared semantic descriptor fields; never mutable target rows. */
export async function canonicalizeAuthoritySubject(input: AuthoritySubjectDescriptorInput): Promise<CanonicalAuthoritySubjectDescriptor> {
  const normalized = normalizedSubjectInput(input);
  const canonicalKey = canonicalJson({
    format: authoritySubjectDescriptorFormat,
    registryVersion: normalized.registryVersion,
    subjectId: normalized.subjectId,
    subjectType: normalized.subjectType,
    versionKind: normalized.versionKind,
    versionToken: normalized.versionToken,
  });
  return {
    format: authoritySubjectDescriptorFormat,
    ...normalized,
    canonicalKey,
    descriptorSha256: await sha256Hex(canonicalKey),
  };
}

export function createAuthoritySubjectResolverRegistry(resolvers: Readonly<Record<string, AuthoritySubjectResolver>>): AuthoritySubjectResolverRegistry {
  return {
    async resolve(descriptor) {
      const resolver = resolvers[descriptor.subjectType];
      if (resolver === undefined) return { status: "UNRESOLVED", reasonCode: "SUBJECT_TYPE_UNREGISTERED" };
      try {
        const result = await resolver(descriptor);
        if (result.status === "MATCH" || result.status === "MISMATCH" || result.status === "UNRESOLVED") return result;
      } catch {
        return { status: "UNRESOLVED", reasonCode: "SUBJECT_RESOLVER_FAILED" };
      }
      return { status: "UNRESOLVED", reasonCode: "SUBJECT_RESOLVER_INVALID_RESULT" };
    },
  };
}

function validPolicyRecord(record: AuthorityPolicyVersionRecord): boolean {
  return isNonEmptyText(record.id)
    && isNonEmptyText(record.policyKey)
    && isPositiveInteger(record.revision)
    && optionalText(record.predecessorPolicyVersionId)
    && (record.recordKind === "POLICY" || record.recordKind === "REVOCATION")
    && isNonEmptyText(record.normativeActionKey)
    && isOneOf(record.authorityMode, authorityModes)
    && isNonEmptyText(record.scopeSchemaKey)
    && isNonEmptyText(record.scopeSchemaVersion)
    && optionalText(record.definitionJson)
    && isNonEmptyText(record.contentSha256)
    && (record.priorDecisionDisposition === "PRESERVE" || record.priorDecisionDisposition === "INVALIDATE");
}

/** Resolves a policy head by structural lineage, never by timestamps or max(revision). */
export function resolvePolicyHead(records: readonly AuthorityPolicyVersionRecord[], policyKey: string): PolicyHeadResolution {
  if (!isNonEmptyText(policyKey)) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_KEY_INVALID" };
  const family = records.filter((record) => record.policyKey === policyKey);
  if (family.length === 0) return { status: "NOT_FOUND" };
  if (family.length > maxFamilyRows || family.some((record) => !validPolicyRecord(record))) {
    return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_RECORD_INVALID" };
  }
  const byId = new Map<string, AuthorityPolicyVersionRecord>();
  for (const record of family) {
    if (byId.has(record.id)) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_ID_DUPLICATE" };
    byId.set(record.id, record);
  }
  const genesis = family.filter((record) => record.revision === 1 && record.predecessorPolicyVersionId === null);
  if (genesis.length !== 1 || family.some((record) => (record.revision === 1) !== (record.predecessorPolicyVersionId === null))) {
    return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_GENESIS_INVALID" };
  }
  const successors = new Map<string, AuthorityPolicyVersionRecord[]>();
  for (const record of family) {
    if (record.predecessorPolicyVersionId === null) continue;
    const predecessor = byId.get(record.predecessorPolicyVersionId);
    if (predecessor === undefined) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_PREDECESSOR_MISSING" };
    if (record.revision !== predecessor.revision + 1
      || record.normativeActionKey !== predecessor.normativeActionKey
      || record.authorityMode !== predecessor.authorityMode) {
      return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_PREDECESSOR_MISMATCH" };
    }
    const children = successors.get(predecessor.id) ?? [];
    children.push(record);
    successors.set(predecessor.id, children);
    if (children.length > 1) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_FORK" };
  }
  const chain: AuthorityPolicyVersionRecord[] = [];
  const seen = new Set<string>();
  let cursor: AuthorityPolicyVersionRecord | undefined = genesis[0];
  while (cursor !== undefined) {
    if (seen.has(cursor.id)) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_CYCLE" };
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = successors.get(cursor.id)?.[0];
  }
  if (chain.length !== family.length) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_DISCONNECTED" };
  const head = chain[chain.length - 1]!;
  return head.recordKind === "POLICY"
    ? { status: "CURRENT_POLICY", head, chain }
    : { status: "DISABLED_OR_REVOKED", head, chain };
}

export function evaluatePriorDecisionApplicability(
  policyResolution: PolicyHeadResolution,
  basisPolicyVersionId: string,
): PriorDecisionApplicability {
  if (!isNonEmptyText(basisPolicyVersionId)) return { status: "UNRESOLVED", reasonCode: "DECISION_BASIS_POLICY_INVALID" };
  if (policyResolution.status === "NOT_FOUND") return { status: "UNRESOLVED", reasonCode: "DECISION_POLICY_FAMILY_NOT_FOUND" };
  if (policyResolution.status === "AMBIGUOUS_OR_CORRUPT") return { status: "UNRESOLVED", reasonCode: policyResolution.reasonCode };
  const basisIndex = policyResolution.chain.findIndex((record) => record.id === basisPolicyVersionId);
  if (basisIndex < 0) return { status: "UNRESOLVED", reasonCode: "DECISION_BASIS_OUTSIDE_POLICY_FAMILY" };
  const traversed = policyResolution.chain.slice(basisIndex).map((record) => record.id);
  const invalidating = policyResolution.chain.slice(basisIndex + 1).find((record) => (
    record.recordKind === "REVOCATION" || record.priorDecisionDisposition === "INVALIDATE"
  ));
  if (invalidating !== undefined) {
    return {
      status: "INVALIDATED",
      basisPolicyVersionId,
      currentHeadPolicyVersionId: policyResolution.head.id,
      traversedPolicyVersionIds: traversed,
      firstInvalidatingPolicyVersionId: invalidating.id,
    };
  }
  if (policyResolution.status === "DISABLED_OR_REVOKED") {
    return {
      status: "INVALIDATED",
      basisPolicyVersionId,
      currentHeadPolicyVersionId: policyResolution.head.id,
      traversedPolicyVersionIds: traversed,
      firstInvalidatingPolicyVersionId: policyResolution.head.id,
    };
  }
  return {
    status: "APPLICABLE",
    basisPolicyVersionId,
    currentHeadPolicyVersionId: policyResolution.head.id,
    traversedPolicyVersionIds: traversed,
  };
}

function validRuleSetRecord(record: ExecutorEligibilityRuleSetVersionRecord): boolean {
  return isNonEmptyText(record.id)
    && isNonEmptyText(record.ruleSetKey)
    && isPositiveInteger(record.revision)
    && optionalText(record.predecessorRuleSetVersionId)
    && (record.recordKind === "RULESET" || record.recordKind === "DISABLED")
    && isNonEmptyText(record.contractCatalogRevision)
    && isNonEmptyText(record.contentSha256);
}

/** Same structural-head rule as policies, with a disabled head failing closed. */
export function resolveEligibilityRuleSetHead(
  records: readonly ExecutorEligibilityRuleSetVersionRecord[],
  ruleSetKey: string,
): EligibilityRuleSetHeadResolution {
  if (!isNonEmptyText(ruleSetKey)) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_KEY_INVALID" };
  const family = records.filter((record) => record.ruleSetKey === ruleSetKey);
  if (family.length === 0) return { status: "NOT_FOUND" };
  if (family.length > maxFamilyRows || family.some((record) => !validRuleSetRecord(record))) {
    return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_RECORD_INVALID" };
  }
  const byId = new Map<string, ExecutorEligibilityRuleSetVersionRecord>();
  for (const record of family) {
    if (byId.has(record.id)) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_ID_DUPLICATE" };
    byId.set(record.id, record);
  }
  const genesis = family.filter((record) => record.revision === 1 && record.predecessorRuleSetVersionId === null);
  if (genesis.length !== 1 || family.some((record) => (record.revision === 1) !== (record.predecessorRuleSetVersionId === null))) {
    return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_GENESIS_INVALID" };
  }
  const successors = new Map<string, ExecutorEligibilityRuleSetVersionRecord[]>();
  for (const record of family) {
    if (record.predecessorRuleSetVersionId === null) continue;
    const predecessor = byId.get(record.predecessorRuleSetVersionId);
    if (predecessor === undefined || record.revision !== predecessor.revision + 1) {
      return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_PREDECESSOR_MISMATCH" };
    }
    const children = successors.get(predecessor.id) ?? [];
    children.push(record);
    successors.set(predecessor.id, children);
    if (children.length > 1) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_FORK" };
  }
  const chain: ExecutorEligibilityRuleSetVersionRecord[] = [];
  const seen = new Set<string>();
  let cursor: ExecutorEligibilityRuleSetVersionRecord | undefined = genesis[0];
  while (cursor !== undefined) {
    if (seen.has(cursor.id)) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_CYCLE" };
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = successors.get(cursor.id)?.[0];
  }
  if (chain.length !== family.length) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_DISCONNECTED" };
  const head = chain[chain.length - 1]!;
  return head.recordKind === "RULESET"
    ? { status: "CURRENT_RULESET", head, chain }
    : { status: "DISABLED", head, chain };
}

function parseGovernanceProposal(value: string): GovernanceProposal | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!isOneOf(record.familyKind, ["POLICY", "ELIGIBILITY_RULESET"] as const)
      || !isNonEmptyText(record.familyKey)
      || !isNonEmptyText(record.expectedPredecessorId)
      || !isPositiveInteger(record.nextRevision)
      || !isNonEmptyText(record.recordKind)
      || !isNonEmptyText(record.proposedContentSha256)) return null;
    return {
      familyKind: record.familyKind,
      familyKey: record.familyKey,
      expectedPredecessorId: record.expectedPredecessorId,
      nextRevision: record.nextRevision,
      recordKind: record.recordKind,
      proposedContentSha256: record.proposedContentSha256,
    };
  } catch {
    return null;
  }
}

/** Bounded condition boundary: governance proposals are the only production schema understood here. */
export function evaluateBoundedAuthorityConditions(input: Readonly<{
  schemaKey: string | null;
  json: string | null;
  governanceProposal?: GovernanceProposal;
}>): BoundedConditionResult {
  if (input.schemaKey === null && input.json === null) return { status: "MATCH" };
  if (!isNonEmptyText(input.schemaKey) || !isNonEmptyText(input.json)) return { status: "UNRESOLVED", reasonCode: "CONDITIONS_SHAPE_INVALID" };
  if (input.schemaKey !== governanceProposalConditionsSchema) return { status: "UNRESOLVED", reasonCode: "CONDITIONS_SCHEMA_UNSUPPORTED" };
  const expected = parseGovernanceProposal(input.json);
  if (expected === null) return { status: "UNRESOLVED", reasonCode: "GOVERNANCE_PROPOSAL_INVALID" };
  if (input.governanceProposal === undefined) return { status: "UNRESOLVED", reasonCode: "GOVERNANCE_PROPOSAL_CONTEXT_REQUIRED" };
  return canonicalJson(expected) === canonicalJson(input.governanceProposal) ? { status: "MATCH" } : { status: "MISMATCH" };
}

function validEligibilityRule(record: ExecutorEligibilityRuleRecord): boolean {
  return isNonEmptyText(record.id)
    && isNonEmptyText(record.ruleSetVersionId)
    && isNonEmptyText(record.capabilityKey)
    && isNonEmptyText(record.contractVariantKey)
    && isOneOf(record.executorType, executorTypes)
    && ["ELIGIBLE", "CONDITIONAL", "INELIGIBLE"].includes(record.verdict)
    && optionalText(record.conditionsSchemaKey)
    && optionalText(record.conditionsJson);
}

export function evaluateExecutorEligibility(input: Readonly<{
  ruleSetRecords: readonly ExecutorEligibilityRuleSetVersionRecord[];
  rules: readonly ExecutorEligibilityRuleRecord[];
  request: ExecutorEligibilityInput;
}>): ExecutorEligibilityResult {
  const ruleSet = resolveEligibilityRuleSetHead(input.ruleSetRecords, input.request.ruleSetKey);
  if (ruleSet.status === "AMBIGUOUS_OR_CORRUPT") return { status: "UNRESOLVED", reasonCode: ruleSet.reasonCode };
  if (ruleSet.status === "NOT_FOUND") return { status: "UNRESOLVED", reasonCode: "RULESET_NOT_FOUND" };
  if (ruleSet.status === "DISABLED") return { status: "INELIGIBLE", reasonCode: "RULESET_DISABLED", ruleSetVersionId: ruleSet.head.id };
  const variant = input.request.contractVariantKey ?? "DEFAULT";
  if (!isNonEmptyText(input.request.capabilityKey) || !isNonEmptyText(variant) || !isOneOf(input.request.executorType, executorTypes)) {
    return { status: "UNRESOLVED", reasonCode: "ELIGIBILITY_REQUEST_INVALID" };
  }
  if (input.rules.some((rule) => !validEligibilityRule(rule))) return { status: "UNRESOLVED", reasonCode: "ELIGIBILITY_RULE_RECORD_INVALID" };
  const matching = input.rules.filter((rule) => (
    rule.ruleSetVersionId === ruleSet.head.id
    && rule.capabilityKey === input.request.capabilityKey
    && rule.contractVariantKey === variant
    && rule.executorType === input.request.executorType
  ));
  if (matching.length === 0) return { status: "UNRESOLVED", reasonCode: "ELIGIBILITY_RULE_MISSING" };
  if (matching.length > 1) return { status: "UNRESOLVED", reasonCode: "ELIGIBILITY_RULE_AMBIGUOUS" };
  const rule = matching[0]!;
  if (rule.verdict === "INELIGIBLE") return { status: "INELIGIBLE", reasonCode: "ELIGIBILITY_RULE_INELIGIBLE", ruleSetVersionId: ruleSet.head.id, ruleId: rule.id };
  if (rule.verdict === "ELIGIBLE") return { status: "ELIGIBLE", ruleSetVersionId: ruleSet.head.id, ruleId: rule.id };
  const conditions = evaluateBoundedAuthorityConditions({
    schemaKey: rule.conditionsSchemaKey,
    json: rule.conditionsJson,
    governanceProposal: input.request.governanceProposal,
  });
  if (conditions.status === "UNRESOLVED") return { status: "UNRESOLVED", reasonCode: conditions.reasonCode };
  if (conditions.status === "MISMATCH") return { status: "INELIGIBLE", reasonCode: "ELIGIBILITY_CONDITIONS_NOT_MET", ruleSetVersionId: ruleSet.head.id, ruleId: rule.id };
  return { status: "CONDITIONALLY_ELIGIBLE", ruleSetVersionId: ruleSet.head.id, ruleId: rule.id };
}

function validRelation(record: AuthorityRelationRecord): boolean {
  return isNonEmptyText(record.id)
    && isNonEmptyText(record.effectingDecisionId)
    && (record.relationKind === "SUPERSEDES" || record.relationKind === "REVOKES")
    && optionalText(record.targetDecisionId)
    && optionalText(record.targetDelegationGrantId)
    && ((record.targetDecisionId === null) !== (record.targetDelegationGrantId === null));
}

function decisionRelationComponentHasCycle(targetDecisionId: string, relations: readonly AuthorityRelationRecord[]): boolean {
  const edges = relations.filter((relation) => relation.relationKind === "SUPERSEDES" && relation.targetDecisionId !== null);
  const connected = new Map<string, Set<string>>();
  const outgoing = new Map<string, string[]>();
  for (const relation of edges) {
    const target = relation.targetDecisionId!;
    const effectingConnections = connected.get(relation.effectingDecisionId) ?? new Set<string>();
    effectingConnections.add(target);
    connected.set(relation.effectingDecisionId, effectingConnections);
    const targetConnections = connected.get(target) ?? new Set<string>();
    targetConnections.add(relation.effectingDecisionId);
    connected.set(target, targetConnections);
    const children = outgoing.get(relation.effectingDecisionId) ?? [];
    children.push(target);
    outgoing.set(relation.effectingDecisionId, children);
  }
  if (!connected.has(targetDecisionId)) return false;
  const component = new Set<string>();
  const pending = [targetDecisionId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (component.has(id)) continue;
    component.add(id);
    for (const neighbour of connected.get(id) ?? []) pending.push(neighbour);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const target of outgoing.get(id) ?? []) {
      if (component.has(target) && visit(target)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...component].some((id) => visit(id));
}

export function resolveDecisionAuthorityRelation(
  decisionId: string,
  relations: readonly AuthorityRelationRecord[],
): AuthorityRelationResolution {
  if (!isNonEmptyText(decisionId)) return { status: "UNRESOLVED", reasonCode: "RELATION_TARGET_INVALID" };
  const relevant = relations.filter((relation) => relation.targetDecisionId === decisionId);
  if (relevant.some((relation) => !validRelation(relation))) return { status: "UNRESOLVED", reasonCode: "RELATION_RECORD_INVALID" };
  if (decisionRelationComponentHasCycle(decisionId, relations)) return { status: "UNRESOLVED", reasonCode: "RELATION_SUPERSEDES_CYCLE" };
  const revocations = relevant.filter((relation) => relation.relationKind === "REVOKES");
  if (revocations.length > 0) return { status: "REVOKED", relationIds: revocations.map((relation) => relation.id) };
  const supersedes = relevant.filter((relation) => relation.relationKind === "SUPERSEDES");
  if (supersedes.length > 1) return { status: "UNRESOLVED", reasonCode: "RELATION_MULTIPLE_SUPERSEDES" };
  if (supersedes.length === 1) return { status: "SUPERSEDED", relationIds: [supersedes[0]!.id] };
  return { status: "ACTIVE", relationIds: [] };
}

export function resolveDelegationAuthorityRelation(
  delegationGrantId: string,
  relations: readonly AuthorityRelationRecord[],
): AuthorityRelationResolution {
  if (!isNonEmptyText(delegationGrantId)) return { status: "UNRESOLVED", reasonCode: "RELATION_TARGET_INVALID" };
  const relevant = relations.filter((relation) => relation.targetDelegationGrantId === delegationGrantId);
  if (relevant.some((relation) => !validRelation(relation))) return { status: "UNRESOLVED", reasonCode: "RELATION_RECORD_INVALID" };
  const revocations = relevant.filter((relation) => relation.relationKind === "REVOKES");
  if (revocations.length > 0) return { status: "REVOKED", relationIds: revocations.map((relation) => relation.id) };
  const supersedes = relevant.filter((relation) => relation.relationKind === "SUPERSEDES");
  if (supersedes.length > 1) return { status: "UNRESOLVED", reasonCode: "RELATION_MULTIPLE_SUPERSEDES" };
  if (supersedes.length === 1) return { status: "SUPERSEDED", relationIds: [supersedes[0]!.id] };
  return { status: "ACTIVE", relationIds: [] };
}

export async function computeCanonicalAuthorityRequestSha256(input: Readonly<{
  normativeActionKey: string;
  capabilityKey: string;
  contractVariantKey?: string | null;
  executorActorId: string;
  executorType: ExecutorType;
  subjectCanonicalKey: string;
  caseOrScopeCanonicalKey?: string | null;
  requestedAuthorityMode: AuthorityMode;
  policyKey: string;
  decisionId?: string | null;
  delegationGrantId?: string | null;
  requestedConsequenceDescriptorKey?: string | null;
  requestedConsequenceSchemaKey?: string | null;
  governanceConsequence?: AuthorityGovernanceConsequenceBinding;
}>): Promise<string> {
  if (!isNonEmptyText(input.normativeActionKey)
    || !isNonEmptyText(input.capabilityKey)
    || !isNonEmptyText(input.executorActorId)
    || !isNonEmptyText(input.subjectCanonicalKey)
    || !isNonEmptyText(input.policyKey)
    || !isOneOf(input.executorType, executorTypes)
    || !isOneOf(input.requestedAuthorityMode, authorityModes)) {
    throw new Error("AUTHORITY_REQUEST_INVALID");
  }
  const contractVariantKey = normalizeOptionalText(input.contractVariantKey) ?? "DEFAULT";
  return sha256Hex(canonicalJson({
    format: authorityRequestDigestFormat,
    normativeActionKey: input.normativeActionKey,
    capabilityKey: input.capabilityKey,
    contractVariantKey,
    executorActorId: input.executorActorId,
    executorType: input.executorType,
    subjectCanonicalKey: input.subjectCanonicalKey,
    caseOrScopeCanonicalKey: normalizeOptionalText(input.caseOrScopeCanonicalKey),
    requestedAuthorityMode: input.requestedAuthorityMode,
    policyKey: input.policyKey,
    decisionId: normalizeOptionalText(input.decisionId),
    delegationGrantId: normalizeOptionalText(input.delegationGrantId),
    requestedConsequenceDescriptorKey: normalizeOptionalText(input.requestedConsequenceDescriptorKey),
    requestedConsequenceSchemaKey: normalizeOptionalText(input.requestedConsequenceSchemaKey),
    governanceConsequence: normalizeGovernanceConsequence(input.governanceConsequence),
  }));
}

function parseTimestamp(value: string): number | null {
  if (!isNonEmptyText(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function readString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return isNonEmptyText(value) ? value : null;
}

function readNullableString(row: Record<string, unknown>, field: string): string | null | undefined {
  const value = row[field];
  if (value === null) return null;
  return isNonEmptyText(value) ? value : undefined;
}

function readNumber(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapPolicyRecord(row: Record<string, unknown>): AuthorityPolicyVersionRecord | null {
  const id = readString(row, "id");
  const policyKey = readString(row, "policyKey");
  const revision = readNumber(row, "revision");
  const predecessorPolicyVersionId = readNullableString(row, "predecessorPolicyVersionId");
  const recordKind = row.recordKind;
  const normativeActionKey = readString(row, "normativeActionKey");
  const authorityMode = row.authorityMode;
  const scopeSchemaKey = readString(row, "scopeSchemaKey");
  const scopeSchemaVersion = readString(row, "scopeSchemaVersion");
  const definitionJson = readNullableString(row, "definitionJson");
  const contentSha256 = readString(row, "contentSha256");
  const priorDecisionDisposition = row.priorDecisionDisposition;
  if (id === null || policyKey === null || revision === null || predecessorPolicyVersionId === undefined
    || (recordKind !== "POLICY" && recordKind !== "REVOCATION") || normativeActionKey === null
    || !isOneOf(authorityMode, authorityModes) || scopeSchemaKey === null || scopeSchemaVersion === null
    || definitionJson === undefined || contentSha256 === null
    || (priorDecisionDisposition !== "PRESERVE" && priorDecisionDisposition !== "INVALIDATE")) return null;
  return { id, policyKey, revision, predecessorPolicyVersionId, recordKind, normativeActionKey, authorityMode, scopeSchemaKey, scopeSchemaVersion, definitionJson, contentSha256, priorDecisionDisposition };
}

function mapRuleSetRecord(row: Record<string, unknown>): ExecutorEligibilityRuleSetVersionRecord | null {
  const id = readString(row, "id");
  const ruleSetKey = readString(row, "ruleSetKey");
  const revision = readNumber(row, "revision");
  const predecessorRuleSetVersionId = readNullableString(row, "predecessorRuleSetVersionId");
  const recordKind = row.recordKind;
  const contractCatalogRevision = readString(row, "contractCatalogRevision");
  const contentSha256 = readString(row, "contentSha256");
  if (id === null || ruleSetKey === null || revision === null || predecessorRuleSetVersionId === undefined
    || (recordKind !== "RULESET" && recordKind !== "DISABLED") || contractCatalogRevision === null || contentSha256 === null) return null;
  return { id, ruleSetKey, revision, predecessorRuleSetVersionId, recordKind, contractCatalogRevision, contentSha256 };
}

function mapEligibilityRule(row: Record<string, unknown>): ExecutorEligibilityRuleRecord | null {
  const id = readString(row, "id");
  const ruleSetVersionId = readString(row, "ruleSetVersionId");
  const capabilityKey = readString(row, "capabilityKey");
  const contractVariantKey = readString(row, "contractVariantKey");
  const executorType = row.executorType;
  const verdict = row.verdict;
  const conditionsSchemaKey = readNullableString(row, "conditionsSchemaKey");
  const conditionsJson = readNullableString(row, "conditionsJson");
  if (id === null || ruleSetVersionId === null || capabilityKey === null || contractVariantKey === null
    || !isOneOf(executorType, executorTypes) || !["ELIGIBLE", "CONDITIONAL", "INELIGIBLE"].includes(String(verdict))
    || conditionsSchemaKey === undefined || conditionsJson === undefined) return null;
  return { id, ruleSetVersionId, capabilityKey, contractVariantKey, executorType, verdict: verdict as ExecutorEligibilityRuleRecord["verdict"], conditionsSchemaKey, conditionsJson };
}

function mapRelation(row: Record<string, unknown>): AuthorityRelationRecord | null {
  const id = readString(row, "id");
  const effectingDecisionId = readString(row, "effectingDecisionId");
  const relationKind = row.relationKind;
  const targetDecisionId = readNullableString(row, "targetDecisionId");
  const targetDelegationGrantId = readNullableString(row, "targetDelegationGrantId");
  if (id === null || effectingDecisionId === null || (relationKind !== "SUPERSEDES" && relationKind !== "REVOKES")
    || targetDecisionId === undefined || targetDelegationGrantId === undefined) return null;
  return { id, effectingDecisionId, relationKind, targetDecisionId, targetDelegationGrantId };
}

function mapDecision(row: Record<string, unknown>): AuthorityDecisionRecord | null {
  const id = readString(row, "id");
  const normativeActionKey = readString(row, "normativeActionKey");
  const decidingActorId = readString(row, "decidingActorId");
  const subjectRefId = readString(row, "subjectRefId");
  const scopeRootSubjectRefId = readNullableString(row, "scopeRootSubjectRefId");
  const basisPolicyVersionId = readString(row, "basisPolicyVersionId");
  const basisDelegationGrantId = readNullableString(row, "basisDelegationGrantId");
  const conditionsSchemaKey = readNullableString(row, "conditionsSchemaKey");
  const conditionsJson = readNullableString(row, "conditionsJson");
  if (id === null || normativeActionKey === null || decidingActorId === null || subjectRefId === null || scopeRootSubjectRefId === undefined
    || basisPolicyVersionId === null || basisDelegationGrantId === undefined || conditionsSchemaKey === undefined || conditionsJson === undefined) return null;
  return { id, normativeActionKey, decidingActorId, subjectRefId, scopeRootSubjectRefId, basisPolicyVersionId, basisDelegationGrantId, conditionsSchemaKey, conditionsJson };
}

function mapDelegation(row: Record<string, unknown>): AuthorityDelegationGrantRecord | null {
  const id = readString(row, "id");
  const grantedPolicyVersionId = readString(row, "grantedPolicyVersionId");
  const delegatorActorId = readNullableString(row, "delegatorActorId");
  const delegateActorId = readString(row, "delegateActorId");
  const scopeRootSubjectRefId = readString(row, "scopeRootSubjectRefId");
  const scopeSchemaKey = readString(row, "scopeSchemaKey");
  const scopeJson = readNullableString(row, "scopeJson");
  const validFrom = readString(row, "validFrom");
  const validUntil = readNullableString(row, "validUntil");
  const grantingPolicyVersionId = readNullableString(row, "grantingPolicyVersionId");
  const grantingDecisionId = readNullableString(row, "grantingDecisionId");
  if (id === null || grantedPolicyVersionId === null || delegatorActorId === undefined || delegateActorId === null || scopeRootSubjectRefId === null
    || scopeSchemaKey === null || scopeJson === undefined || validFrom === null || validUntil === undefined
    || grantingPolicyVersionId === undefined || grantingDecisionId === undefined) return null;
  return { id, grantedPolicyVersionId, delegatorActorId, delegateActorId, scopeRootSubjectRefId, scopeSchemaKey, scopeJson, validFrom, validUntil, grantingPolicyVersionId, grantingDecisionId };
}

async function readRows(database: AuthorityD1Database, query: string, ...values: unknown[]): Promise<Record<string, unknown>[] | null> {
  try {
    const result = await database.prepare(query).bind(...values).all<Record<string, unknown>>();
    return Array.isArray(result.results) ? result.results : null;
  } catch {
    return null;
  }
}

async function readRow(database: AuthorityD1Database, query: string, ...values: unknown[]): Promise<Record<string, unknown> | null | undefined> {
  try {
    const result = await database.prepare(query).bind(...values).first<Record<string, unknown>>();
    if (result === null) return null;
    return typeof result === "object" ? result : undefined;
  } catch {
    return undefined;
  }
}

async function readPolicyFamily(database: AuthorityD1Database, policyKey: string): Promise<PolicyHeadResolution | null> {
  const rows = await readRows(database, `
SELECT "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition"
FROM "AuthorityPolicyVersion"
WHERE "policyKey" = ?
ORDER BY "revision" ASC, "id" ASC
LIMIT ?
`, policyKey, maxFamilyRows + 1);
  if (rows === null) return null;
  if (rows.length > maxFamilyRows) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_FAMILY_TOO_LARGE" };
  const records = rows.map(mapPolicyRecord);
  if (records.some((record) => record === null)) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "POLICY_ROW_INVALID" };
  return resolvePolicyHead(records as AuthorityPolicyVersionRecord[], policyKey);
}

async function readRuleSetFamily(database: AuthorityD1Database, ruleSetKey: string): Promise<EligibilityRuleSetHeadResolution | null> {
  const rows = await readRows(database, `
SELECT "id", "ruleSetKey", "revision", "predecessorRuleSetVersionId", "recordKind", "contractCatalogRevision", "contentSha256"
FROM "ExecutorEligibilityRuleSetVersion"
WHERE "ruleSetKey" = ?
ORDER BY "revision" ASC, "id" ASC
LIMIT ?
`, ruleSetKey, maxFamilyRows + 1);
  if (rows === null) return null;
  if (rows.length > maxFamilyRows) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_FAMILY_TOO_LARGE" };
  const records = rows.map(mapRuleSetRecord);
  if (records.some((record) => record === null)) return { status: "AMBIGUOUS_OR_CORRUPT", reasonCode: "RULESET_ROW_INVALID" };
  return resolveEligibilityRuleSetHead(records as ExecutorEligibilityRuleSetVersionRecord[], ruleSetKey);
}

async function readPolicyVersionById(database: AuthorityD1Database, id: string): Promise<AuthorityPolicyVersionRecord | null | undefined> {
  const row = await readRow(database, `
SELECT "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition"
FROM "AuthorityPolicyVersion" WHERE "id" = ?
`, id);
  if (row === undefined || row === null) return row;
  return mapPolicyRecord(row) ?? undefined;
}

async function readAllRelations(database: AuthorityD1Database): Promise<AuthorityRelationRecord[] | null> {
  const rows = await readRows(database, `
SELECT "id", "effectingDecisionId", "relationKind", "targetDecisionId", "targetDelegationGrantId"
FROM "AuthorityRelation"
ORDER BY "id" ASC
LIMIT ?
`, maxFamilyRows + 1);
  if (rows === null || rows.length > maxFamilyRows) return null;
  const relations = rows.map(mapRelation);
  return relations.some((relation) => relation === null) ? null : relations as AuthorityRelationRecord[];
}

async function readActor(database: AuthorityD1Database, id: string): Promise<AuthorityActorRecord | null | undefined> {
  const row = await readRow(database, 'SELECT "id", "category" FROM "Actor" WHERE "id" = ?', id);
  if (row === undefined || row === null) return row;
  const actorId = readString(row, "id");
  const category = readString(row, "category");
  return actorId === null || category === null ? undefined : { id: actorId, category };
}

async function readDecision(database: AuthorityD1Database, id: string): Promise<AuthorityDecisionRecord | null | undefined> {
  const row = await readRow(database, `
SELECT "id", "normativeActionKey", "decidingActorId", "subjectRefId", "scopeRootSubjectRefId", "basisPolicyVersionId", "basisDelegationGrantId", "conditionsSchemaKey", "conditionsJson"
FROM "Decision" WHERE "id" = ?
`, id);
  if (row === undefined || row === null) return row;
  return mapDecision(row) ?? undefined;
}

async function readDelegation(database: AuthorityD1Database, id: string): Promise<AuthorityDelegationGrantRecord | null | undefined> {
  const row = await readRow(database, `
SELECT "id", "grantedPolicyVersionId", "delegatorActorId", "delegateActorId", "scopeRootSubjectRefId", "scopeSchemaKey", "scopeJson", "validFrom", "validUntil", "grantingPolicyVersionId", "grantingDecisionId"
FROM "DelegationGrant" WHERE "id" = ?
`, id);
  if (row === undefined || row === null) return row;
  return mapDelegation(row) ?? undefined;
}

export function createTr03AuthoritySubjectResolverRegistry(database: AuthorityD1Database): AuthoritySubjectResolverRegistry {
  return createAuthoritySubjectResolverRegistry({
    POLICY_FAMILY_DESCRIPTOR: async (descriptor) => {
      if (descriptor.versionKind !== "EXACT_VERSION" || descriptor.versionToken === null) return { status: "MISMATCH", reasonCode: "POLICY_DESCRIPTOR_VERSION_REQUIRED" };
      const policy = await readPolicyVersionById(database, descriptor.versionToken);
      if (policy === undefined) return { status: "UNRESOLVED", reasonCode: "POLICY_DESCRIPTOR_READ_FAILED" };
      return policy !== null && policy.policyKey === descriptor.subjectId ? { status: "MATCH" } : { status: "MISMATCH", reasonCode: "POLICY_DESCRIPTOR_MISMATCH" };
    },
    ELIGIBILITY_RULESET_FAMILY_DESCRIPTOR: async (descriptor) => {
      if (descriptor.versionKind !== "EXACT_VERSION" || descriptor.versionToken === null) return { status: "MISMATCH", reasonCode: "RULESET_DESCRIPTOR_VERSION_REQUIRED" };
      const row = await readRow(database, 'SELECT "id", "ruleSetKey" FROM "ExecutorEligibilityRuleSetVersion" WHERE "id" = ?', descriptor.versionToken);
      if (row === undefined) return { status: "UNRESOLVED", reasonCode: "RULESET_DESCRIPTOR_READ_FAILED" };
      const ruleSetKey = row === null ? null : readString(row, "ruleSetKey");
      return ruleSetKey !== null && ruleSetKey === descriptor.subjectId ? { status: "MATCH" } : { status: "MISMATCH", reasonCode: "RULESET_DESCRIPTOR_MISMATCH" };
    },
  });
}

type ResolvedSubject = Readonly<{
  descriptor: CanonicalAuthoritySubjectDescriptor;
  subjectRefId: string;
}>;

async function resolveStoredSubject(
  database: AuthorityD1Database,
  registry: AuthoritySubjectResolverRegistry,
  input: AuthoritySubjectDescriptorInput,
): Promise<ResolvedSubject | AuthoritySubjectResolution> {
  let descriptor: CanonicalAuthoritySubjectDescriptor;
  try {
    descriptor = await canonicalizeAuthoritySubject(input);
  } catch {
    return { status: "UNRESOLVED", reasonCode: "SUBJECT_DESCRIPTOR_INVALID" };
  }
  const registryResult = await registry.resolve(descriptor);
  if (registryResult.status !== "MATCH") return registryResult;
  const row = await readRow(database, `
SELECT "id", "registryVersion", "subjectType", "subjectId", "versionKind", "versionToken", "descriptorFormat", "canonicalKey", "descriptorSha256"
FROM "AuthoritySubjectRef" WHERE "canonicalKey" = ?
`, descriptor.canonicalKey);
  if (row === undefined) return { status: "UNRESOLVED", reasonCode: "SUBJECT_REF_READ_FAILED" };
  if (row === null) return { status: "MISMATCH", reasonCode: "SUBJECT_REF_NOT_FOUND" };
  const id = readString(row, "id");
  const registryVersion = readString(row, "registryVersion");
  const subjectType = readString(row, "subjectType");
  const subjectId = readString(row, "subjectId");
  const versionKind = row.versionKind;
  const versionToken = readNullableString(row, "versionToken");
  const descriptorFormat = readString(row, "descriptorFormat");
  const canonicalKey = readString(row, "canonicalKey");
  const descriptorSha256 = readString(row, "descriptorSha256");
  if (id === null || registryVersion === null || subjectType === null || subjectId === null || !isOneOf(versionKind, authoritySubjectVersionKinds)
    || versionToken === undefined || descriptorFormat === null || canonicalKey === null || descriptorSha256 === null) {
    return { status: "UNRESOLVED", reasonCode: "SUBJECT_REF_CORRUPT" };
  }
  return registryVersion === descriptor.registryVersion
    && subjectType === descriptor.subjectType
    && subjectId === descriptor.subjectId
    && versionKind === descriptor.versionKind
    && versionToken === descriptor.versionToken
    && descriptorFormat === descriptor.format
    && canonicalKey === descriptor.canonicalKey
    && descriptorSha256 === descriptor.descriptorSha256
    ? { descriptor, subjectRefId: id }
    : { status: "MISMATCH", reasonCode: "SUBJECT_REF_DESCRIPTOR_MISMATCH" };
}

async function readRulesForRuleSet(database: AuthorityD1Database, ruleSetVersionId: string): Promise<ExecutorEligibilityRuleRecord[] | null> {
  const rows = await readRows(database, `
SELECT "id", "ruleSetVersionId", "capabilityKey", "contractVariantKey", "executorType", "verdict", "conditionsSchemaKey", "conditionsJson"
FROM "ExecutorEligibilityRule" WHERE "ruleSetVersionId" = ?
ORDER BY "id" ASC LIMIT ?
`, ruleSetVersionId, maxFamilyRows + 1);
  if (rows === null || rows.length > maxFamilyRows) return null;
  const rules = rows.map(mapEligibilityRule);
  return rules.some((rule) => rule === null) ? null : rules as ExecutorEligibilityRuleRecord[];
}

async function evaluateEligibilityFromDatabase(
  database: AuthorityD1Database,
  request: AuthorityInvocationRequest,
): Promise<ExecutorEligibilityResult> {
  const resolution = await readRuleSetFamily(database, request.ruleSetKey);
  if (resolution === null) return { status: "UNRESOLVED", reasonCode: "RULESET_READ_FAILED" };
  if (resolution.status === "AMBIGUOUS_OR_CORRUPT") return { status: "UNRESOLVED", reasonCode: resolution.reasonCode };
  if (resolution.status === "NOT_FOUND") return { status: "UNRESOLVED", reasonCode: "RULESET_NOT_FOUND" };
  if (resolution.status === "DISABLED") return { status: "INELIGIBLE", reasonCode: "RULESET_DISABLED", ruleSetVersionId: resolution.head.id };
  const rules = await readRulesForRuleSet(database, resolution.head.id);
  if (rules === null) return { status: "UNRESOLVED", reasonCode: "ELIGIBILITY_RULE_READ_FAILED" };
  return evaluateExecutorEligibility({
    ruleSetRecords: resolution.chain,
    rules,
    request: {
      ruleSetKey: request.ruleSetKey,
      capabilityKey: request.capabilityKey,
      contractVariantKey: request.contractVariantKey,
      executorType: request.executorType,
      governanceProposal: request.governanceProposal,
    },
  });
}

async function resolveGrantingPolicy(
  database: AuthorityD1Database,
  grant: AuthorityDelegationGrantRecord,
): Promise<"ACTIVE" | "DENIED" | "UNRESOLVED"> {
  if ((grant.grantingPolicyVersionId === null) === (grant.grantingDecisionId === null)) return "UNRESOLVED";
  if (grant.grantingPolicyVersionId !== null) {
    const policy = await readPolicyVersionById(database, grant.grantingPolicyVersionId);
    if (policy === undefined) return "UNRESOLVED";
    if (policy === null) return "DENIED";
    const family = await readPolicyFamily(database, policy.policyKey);
    if (family === null || family.status === "AMBIGUOUS_OR_CORRUPT") return "UNRESOLVED";
    return family.status === "CURRENT_POLICY" && family.head.id === policy.id ? "ACTIVE" : "DENIED";
  }
  const decision = await readDecision(database, grant.grantingDecisionId!);
  if (decision === undefined) return "UNRESOLVED";
  if (decision === null) return "DENIED";
  const actor = await readActor(database, decision.decidingActorId);
  if (actor === undefined) return "UNRESOLVED";
  if (actor === null || actor.category !== "HUMAN") return "DENIED";
  const policy = await readPolicyVersionById(database, decision.basisPolicyVersionId);
  if (policy === undefined) return "UNRESOLVED";
  if (policy === null) return "DENIED";
  const family = await readPolicyFamily(database, policy.policyKey);
  if (family === null || family.status === "AMBIGUOUS_OR_CORRUPT") return "UNRESOLVED";
  const applicability = evaluatePriorDecisionApplicability(family, decision.basisPolicyVersionId);
  if (applicability.status === "UNRESOLVED") return "UNRESOLVED";
  if (applicability.status === "INVALIDATED") return "DENIED";
  const relations = await readAllRelations(database);
  if (relations === null) return "UNRESOLVED";
  const relation = resolveDecisionAuthorityRelation(decision.id, relations);
  return relation.status === "ACTIVE" ? "ACTIVE" : relation.status === "UNRESOLVED" ? "UNRESOLVED" : "DENIED";
}

async function resolveAuthorityBasis(
  database: AuthorityD1Database,
  request: AuthorityInvocationRequest,
  subject: ResolvedSubject,
  caseOrScopeSubject: ResolvedSubject | null,
  policy: Extract<PolicyHeadResolution, { status: "CURRENT_POLICY" }>,
): Promise<InvocationAuthorityEvaluation> {
  if (policy.head.authorityMode !== request.requestedAuthorityMode || policy.head.normativeActionKey !== request.normativeActionKey) {
    return { outcome: "DENIED", reasonCode: "POLICY_MODE_OR_ACTION_MISMATCH" };
  }
  if (request.requestedAuthorityMode === "POLICY_GOVERNED") {
    if (request.decisionId !== undefined && request.decisionId !== null || request.delegationGrantId !== undefined && request.delegationGrantId !== null) {
      return { outcome: "DENIED", reasonCode: "POLICY_GOVERNED_BASIS_MUST_BE_DIRECT" };
    }
    return { outcome: "AUTHORIZED", context: {
      subjectRefId: subject.subjectRefId,
      caseOrScopeSubjectRefId: caseOrScopeSubject?.subjectRefId ?? null,
      policyVersionId: policy.head.id,
      eligibilityRuleSetVersionId: "",
      eligibilityRuleId: "",
      decisionId: null,
      delegationGrantId: null,
    }, canonicalRequestSha256: "" };
  }
  if (request.requestedAuthorityMode === "HUMAN_GATED") {
    if (!isNonEmptyText(request.decisionId) || request.delegationGrantId !== undefined && request.delegationGrantId !== null) {
      return { outcome: "DENIED", reasonCode: "HUMAN_DECISION_REQUIRED" };
    }
    const decision = await readDecision(database, request.decisionId);
    if (decision === undefined) return { outcome: "UNRESOLVED", reasonCode: "DECISION_READ_FAILED" };
    if (decision === null) return { outcome: "DENIED", reasonCode: "DECISION_NOT_FOUND" };
    if (decision.basisDelegationGrantId !== null || decision.basisPolicyVersionId === "" || decision.normativeActionKey !== request.normativeActionKey
      || decision.subjectRefId !== subject.subjectRefId || !sameOptional(decision.scopeRootSubjectRefId, caseOrScopeSubject?.subjectRefId ?? null)) {
      return { outcome: "DENIED", reasonCode: "HUMAN_DECISION_MISMATCH" };
    }
    const actor = await readActor(database, decision.decidingActorId);
    if (actor === undefined) return { outcome: "UNRESOLVED", reasonCode: "DECISION_ACTOR_READ_FAILED" };
    if (actor === null || actor.category !== "HUMAN") return { outcome: "DENIED", reasonCode: "DECISION_ACTOR_NOT_HUMAN" };
    const applicability = evaluatePriorDecisionApplicability(policy, decision.basisPolicyVersionId);
    if (applicability.status === "UNRESOLVED") return { outcome: "UNRESOLVED", reasonCode: applicability.reasonCode };
    if (applicability.status === "INVALIDATED") return { outcome: "DENIED", reasonCode: "DECISION_POLICY_INVALIDATED" };
    const conditions = evaluateBoundedAuthorityConditions({ schemaKey: decision.conditionsSchemaKey, json: decision.conditionsJson, governanceProposal: request.governanceProposal });
    if (conditions.status === "UNRESOLVED") return { outcome: "UNRESOLVED", reasonCode: conditions.reasonCode };
    if (conditions.status === "MISMATCH") return { outcome: "DENIED", reasonCode: "DECISION_CONDITIONS_NOT_MET" };
    const relations = await readAllRelations(database);
    if (relations === null) return { outcome: "UNRESOLVED", reasonCode: "DECISION_RELATION_READ_FAILED" };
    const relation = resolveDecisionAuthorityRelation(decision.id, relations);
    if (relation.status === "UNRESOLVED") return { outcome: "UNRESOLVED", reasonCode: relation.reasonCode };
    if (relation.status !== "ACTIVE") return { outcome: "DENIED", reasonCode: "DECISION_RELATION_INVALIDATED" };
    return { outcome: "AUTHORIZED", context: {
      subjectRefId: subject.subjectRefId,
      caseOrScopeSubjectRefId: caseOrScopeSubject?.subjectRefId ?? null,
      policyVersionId: policy.head.id,
      eligibilityRuleSetVersionId: "",
      eligibilityRuleId: "",
      decisionId: decision.id,
      delegationGrantId: null,
    }, canonicalRequestSha256: "" };
  }
  if (!isNonEmptyText(request.delegationGrantId)) return { outcome: "DENIED", reasonCode: "DELEGATION_REQUIRED" };
  const grant = await readDelegation(database, request.delegationGrantId);
  if (grant === undefined) return { outcome: "UNRESOLVED", reasonCode: "DELEGATION_READ_FAILED" };
  if (grant === null) return { outcome: "DENIED", reasonCode: "DELEGATION_NOT_FOUND" };
  if (grant.grantedPolicyVersionId !== policy.head.id || grant.delegateActorId !== request.executorActorId
    || caseOrScopeSubject === null || grant.scopeRootSubjectRefId !== caseOrScopeSubject.subjectRefId) {
    return { outcome: "DENIED", reasonCode: "DELEGATION_MISMATCH" };
  }
  const evaluatedAt = parseTimestamp(request.evaluatedAt);
  const validFrom = parseTimestamp(grant.validFrom);
  const validUntil = grant.validUntil === null ? null : parseTimestamp(grant.validUntil);
  if (evaluatedAt === null || validFrom === null || (grant.validUntil !== null && validUntil === null)) return { outcome: "UNRESOLVED", reasonCode: "DELEGATION_TIME_INVALID" };
  if (evaluatedAt < validFrom || (validUntil !== null && evaluatedAt >= validUntil)) return { outcome: "DENIED", reasonCode: "DELEGATION_EXPIRED" };
  const grantingBasis = await resolveGrantingPolicy(database, grant);
  if (grantingBasis === "UNRESOLVED") return { outcome: "UNRESOLVED", reasonCode: "DELEGATION_GRANTING_BASIS_UNRESOLVED" };
  if (grantingBasis === "DENIED") return { outcome: "DENIED", reasonCode: "DELEGATION_GRANTING_BASIS_INVALID" };
  const scope = evaluateBoundedAuthorityConditions({ schemaKey: grant.scopeJson === null ? null : grant.scopeSchemaKey, json: grant.scopeJson, governanceProposal: request.governanceProposal });
  if (scope.status === "UNRESOLVED") return { outcome: "UNRESOLVED", reasonCode: scope.reasonCode };
  if (scope.status === "MISMATCH") return { outcome: "DENIED", reasonCode: "DELEGATION_SCOPE_NOT_MET" };
  const relations = await readAllRelations(database);
  if (relations === null) return { outcome: "UNRESOLVED", reasonCode: "DELEGATION_RELATION_READ_FAILED" };
  const relation = resolveDelegationAuthorityRelation(grant.id, relations);
  if (relation.status === "UNRESOLVED") return { outcome: "UNRESOLVED", reasonCode: relation.reasonCode };
  if (relation.status !== "ACTIVE") return { outcome: "DENIED", reasonCode: "DELEGATION_RELATION_INVALIDATED" };
  if (request.decisionId !== undefined && request.decisionId !== null) {
    const decision = await readDecision(database, request.decisionId);
    if (decision === undefined) return { outcome: "UNRESOLVED", reasonCode: "DELEGATED_DECISION_READ_FAILED" };
    if (decision === null || decision.basisDelegationGrantId !== grant.id || decision.basisPolicyVersionId !== policy.head.id
      || decision.normativeActionKey !== request.normativeActionKey || decision.subjectRefId !== subject.subjectRefId) {
      return { outcome: "DENIED", reasonCode: "DELEGATED_DECISION_MISMATCH" };
    }
    const decisionRelation = resolveDecisionAuthorityRelation(decision.id, relations);
    if (decisionRelation.status === "UNRESOLVED") return { outcome: "UNRESOLVED", reasonCode: decisionRelation.reasonCode };
    if (decisionRelation.status !== "ACTIVE") return { outcome: "DENIED", reasonCode: "DELEGATED_DECISION_INVALIDATED" };
  }
  return { outcome: "AUTHORIZED", context: {
    subjectRefId: subject.subjectRefId,
    caseOrScopeSubjectRefId: caseOrScopeSubject.subjectRefId,
    policyVersionId: policy.head.id,
    eligibilityRuleSetVersionId: "",
    eligibilityRuleId: "",
    decisionId: request.decisionId ?? null,
    delegationGrantId: grant.id,
  }, canonicalRequestSha256: "" };
}

export type AuthorityEvaluator = Readonly<{
  evaluateInvocation(request: AuthorityInvocationRequest): Promise<InvocationAuthorityEvaluation>;
  reconcileAuthorityInvocation(invocationKey: string, canonicalRequestSha256: string): Promise<AuthorityInvocationReconciliation>;
}>;

/** Creates a read-only evaluator. There is intentionally no create/commit method. */
export function createAuthorityEvaluator(
  database: AuthorityD1Database,
  registry: AuthoritySubjectResolverRegistry = createTr03AuthoritySubjectResolverRegistry(database),
): AuthorityEvaluator {
  async function evaluateInvocation(request: AuthorityInvocationRequest): Promise<InvocationAuthorityEvaluation> {
    let canonicalRequestSha256: string;
    let canonicalSubject: CanonicalAuthoritySubjectDescriptor;
    let canonicalScope: CanonicalAuthoritySubjectDescriptor | null = null;
    try {
      canonicalSubject = await canonicalizeAuthoritySubject(request.subject);
      canonicalScope = request.caseOrScopeSubject === undefined || request.caseOrScopeSubject === null
        ? null
        : await canonicalizeAuthoritySubject(request.caseOrScopeSubject);
      canonicalRequestSha256 = await computeCanonicalAuthorityRequestSha256({
        normativeActionKey: request.normativeActionKey,
        capabilityKey: request.capabilityKey,
        contractVariantKey: request.contractVariantKey,
        executorActorId: request.executorActorId,
        executorType: request.executorType,
        subjectCanonicalKey: canonicalSubject.canonicalKey,
        caseOrScopeCanonicalKey: canonicalScope?.canonicalKey ?? null,
        requestedAuthorityMode: request.requestedAuthorityMode,
        policyKey: request.policyKey,
        decisionId: request.decisionId,
        delegationGrantId: request.delegationGrantId,
        requestedConsequenceDescriptorKey: request.requestedConsequenceDescriptorKey,
        requestedConsequenceSchemaKey: request.requestedConsequenceSchemaKey,
        governanceConsequence: request.governanceConsequence,
      });
    } catch {
      return { outcome: "UNRESOLVED", reasonCode: "INVOCATION_REQUEST_INVALID" };
    }
    if (!isNonEmptyText(request.invocationKey)) return { outcome: "UNRESOLVED", reasonCode: "INVOCATION_KEY_INVALID", canonicalRequestSha256 };
    const executor = await readActor(database, request.executorActorId);
    if (executor === undefined) return { outcome: "UNRESOLVED", reasonCode: "EXECUTOR_READ_FAILED", canonicalRequestSha256 };
    if (executor === null) return { outcome: "DENIED", reasonCode: "EXECUTOR_NOT_FOUND", canonicalRequestSha256 };
    if (executor.category === "EXTERNAL_PARTY") return { outcome: "DENIED", reasonCode: "EXECUTOR_EXTERNAL_PARTY", canonicalRequestSha256 };
    const subjectResolution = await resolveStoredSubject(database, registry, request.subject);
    if ("status" in subjectResolution) {
      if (subjectResolution.status === "MISMATCH") {
        return { outcome: "DENIED", reasonCode: subjectResolution.reasonCode ?? "SUBJECT_MISMATCH", canonicalRequestSha256 };
      }
      if (subjectResolution.status === "UNRESOLVED") {
        return { outcome: "UNRESOLVED", reasonCode: subjectResolution.reasonCode, canonicalRequestSha256 };
      }
      return { outcome: "UNRESOLVED", reasonCode: "SUBJECT_RESOLVER_MATCH_WITHOUT_REFERENCE", canonicalRequestSha256 };
    }
    let scopeResolution: ResolvedSubject | null = null;
    if (request.caseOrScopeSubject !== undefined && request.caseOrScopeSubject !== null) {
      const resolved = await resolveStoredSubject(database, registry, request.caseOrScopeSubject);
      if ("status" in resolved) {
        if (resolved.status === "MISMATCH") {
          return { outcome: "DENIED", reasonCode: resolved.reasonCode ?? "SCOPE_SUBJECT_MISMATCH", canonicalRequestSha256 };
        }
        if (resolved.status === "UNRESOLVED") {
          return { outcome: "UNRESOLVED", reasonCode: resolved.reasonCode, canonicalRequestSha256 };
        }
        return { outcome: "UNRESOLVED", reasonCode: "SCOPE_RESOLVER_MATCH_WITHOUT_REFERENCE", canonicalRequestSha256 };
      }
      scopeResolution = resolved;
    }
    const policyResolution = await readPolicyFamily(database, request.policyKey);
    if (policyResolution === null) return { outcome: "UNRESOLVED", reasonCode: "POLICY_READ_FAILED", canonicalRequestSha256 };
    if (policyResolution.status === "AMBIGUOUS_OR_CORRUPT") return { outcome: "UNRESOLVED", reasonCode: policyResolution.reasonCode, canonicalRequestSha256 };
    if (policyResolution.status === "NOT_FOUND") return { outcome: "DENIED", reasonCode: "POLICY_NOT_FOUND", canonicalRequestSha256 };
    if (policyResolution.status === "DISABLED_OR_REVOKED") return { outcome: "DENIED", reasonCode: "POLICY_DISABLED_OR_REVOKED", canonicalRequestSha256 };
    const eligibility = await evaluateEligibilityFromDatabase(database, request);
    if (eligibility.status === "UNRESOLVED") return { outcome: "UNRESOLVED", reasonCode: eligibility.reasonCode, canonicalRequestSha256 };
    if (eligibility.status === "INELIGIBLE") return { outcome: "DENIED", reasonCode: eligibility.reasonCode, canonicalRequestSha256 };
    const basis = await resolveAuthorityBasis(database, request, subjectResolution, scopeResolution, policyResolution);
    if (basis.outcome !== "AUTHORIZED") return { ...basis, canonicalRequestSha256 };
    return {
      outcome: "AUTHORIZED",
      canonicalRequestSha256,
      context: {
        ...basis.context,
        eligibilityRuleSetVersionId: eligibility.ruleSetVersionId,
        eligibilityRuleId: eligibility.ruleId,
      },
    };
  }

  return { evaluateInvocation, reconcileAuthorityInvocation: (invocationKey, digest) => reconcileAuthorityInvocation(database, invocationKey, digest) };
}

function mapPersistedInvocation(row: Record<string, unknown>): PersistedAuthorityInvocation | null {
  const id = readString(row, "id");
  const invocationKey = readString(row, "invocationKey");
  const canonicalRequestSha256 = readString(row, "canonicalRequestSha256");
  const normativeActionKey = readString(row, "normativeActionKey");
  const capabilityKey = readString(row, "capabilityKey");
  const contractVariantKey = readNullableString(row, "contractVariantKey");
  const executorActorId = readString(row, "executorActorId");
  const executorType = row.executorType;
  const subjectRefId = readString(row, "subjectRefId");
  const caseSubjectRefId = readNullableString(row, "caseSubjectRefId");
  const policyVersionId = readString(row, "policyVersionId");
  const eligibilityRuleSetVersionId = readString(row, "eligibilityRuleSetVersionId");
  const eligibilityRuleId = readString(row, "eligibilityRuleId");
  const decisionId = readNullableString(row, "decisionId");
  const delegationGrantId = readNullableString(row, "delegationGrantId");
  const outcome = row.outcome;
  const lineageSha256 = readString(row, "lineageSha256");
  const evaluatedAt = readString(row, "evaluatedAt");
  const createdAt = readString(row, "createdAt");
  if (id === null || invocationKey === null || canonicalRequestSha256 === null || normativeActionKey === null || capabilityKey === null
    || contractVariantKey === undefined || executorActorId === null || !isOneOf(executorType, executorTypes) || subjectRefId === null
    || caseSubjectRefId === undefined || policyVersionId === null || eligibilityRuleSetVersionId === null || eligibilityRuleId === null
    || decisionId === undefined || delegationGrantId === undefined || outcome !== "AUTHORIZED" || lineageSha256 === null || evaluatedAt === null || createdAt === null
    || !sha256Pattern.test(canonicalRequestSha256) || !sha256Pattern.test(lineageSha256)) return null;
  return { id, invocationKey, canonicalRequestSha256, normativeActionKey, capabilityKey, contractVariantKey, executorActorId, executorType, subjectRefId, caseSubjectRefId, policyVersionId, eligibilityRuleSetVersionId, eligibilityRuleId, decisionId, delegationGrantId, outcome, lineageSha256, evaluatedAt, createdAt };
}

/** Reads immutable authority history only. MATCHED never asserts a consequence exists. */
export async function reconcileAuthorityInvocation(
  database: AuthorityD1Database,
  invocationKey: string,
  canonicalRequestSha256: string,
): Promise<AuthorityInvocationReconciliation> {
  if (!isNonEmptyText(invocationKey) || !sha256Pattern.test(canonicalRequestSha256)) return { status: "CORRUPT", reasonCode: "RECONCILIATION_INPUT_INVALID" };
  const row = await readRow(database, `
SELECT "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "contractVariantKey", "executorActorId", "executorType", "subjectRefId", "caseSubjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "decisionId", "delegationGrantId", "outcome", "lineageSha256", "evaluatedAt", "createdAt"
FROM "AuthorityInvocation" WHERE "invocationKey" = ?
`, invocationKey);
  if (row === undefined) return { status: "CORRUPT", reasonCode: "INVOCATION_READ_FAILED" };
  if (row === null) return { status: "NOT_FOUND" };
  const invocation = mapPersistedInvocation(row);
  if (invocation === null) return { status: "CORRUPT", reasonCode: "INVOCATION_ROW_INVALID" };
  if (invocation.canonicalRequestSha256 !== canonicalRequestSha256) {
    return { status: "DIGEST_MISMATCH", invocationId: invocation.id, persistedCanonicalRequestSha256: invocation.canonicalRequestSha256 };
  }
  return { status: "MATCHED", invocation, consequenceProven: false };
}

/** Pure planning helper. Deliberately does not assign an id or issue SQL. */
export async function prepareAuthorizedAuthorityInvocation(
  request: AuthorityInvocationRequest,
  evaluation: Extract<InvocationAuthorityEvaluation, { outcome: "AUTHORIZED" }>,
): Promise<PreparedAuthorityInvocation> {
  const lineageSha256 = await sha256Hex(canonicalJson({
    format: authorityLineageDigestFormat,
    policyVersionId: evaluation.context.policyVersionId,
    eligibilityRuleSetVersionId: evaluation.context.eligibilityRuleSetVersionId,
    eligibilityRuleId: evaluation.context.eligibilityRuleId,
    decisionId: evaluation.context.decisionId,
    delegationGrantId: evaluation.context.delegationGrantId,
    subjectRefId: evaluation.context.subjectRefId,
    caseOrScopeSubjectRefId: evaluation.context.caseOrScopeSubjectRefId,
  }));
  return {
    state: "PREPARED",
    requiresCommitTimeRevalidation: true,
    fields: {
      invocationKey: request.invocationKey,
      canonicalRequestSha256: evaluation.canonicalRequestSha256,
      normativeActionKey: request.normativeActionKey,
      capabilityKey: request.capabilityKey,
      contractVariantKey: request.contractVariantKey ?? null,
      executorActorId: request.executorActorId,
      executorType: request.executorType,
      subjectRefId: evaluation.context.subjectRefId,
      caseSubjectRefId: evaluation.context.caseOrScopeSubjectRefId,
      policyVersionId: evaluation.context.policyVersionId,
      eligibilityRuleSetVersionId: evaluation.context.eligibilityRuleSetVersionId,
      eligibilityRuleId: evaluation.context.eligibilityRuleId,
      decisionId: evaluation.context.decisionId,
      delegationGrantId: evaluation.context.delegationGrantId,
      outcome: "AUTHORIZED",
      lineageSha256,
      evaluatedAt: request.evaluatedAt,
    },
  };
}
