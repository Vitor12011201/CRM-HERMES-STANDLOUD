/**
 * TR-03D's only mutable authority-kernel surface.
 *
 * This module intentionally exposes two concrete consequence writers instead
 * of a generic SQL or "authorized consequence" primitive.  Each writer
 * rebuilds authority immediately before its single native D1 batch.
 */

import {
  canonicalizeAuthoritySubject,
  computeCanonicalAuthorityRequestSha256,
  createAuthorityEvaluator,
  prepareAuthorizedAuthorityInvocation,
  reconcileAuthorityInvocation,
  type AuthorityD1Database,
  type AuthorityGovernanceConsequenceBinding,
  type AuthorityInvocationRequest,
  type AuthorityMode,
  type AuthorityPreparedStatement,
  type ExecutorType,
} from "./authority";

export const authorityGovernanceActionKey = "AUTHORITY_POLICY_GOVERNANCE";
export const maxGovernanceRuleSetChildren = 128;

export type AuthorityGovernanceD1Database = AuthorityD1Database & Readonly<{
  batch(statements: readonly AuthorityPreparedStatement[]): Promise<readonly unknown[]>;
}>;

export type GovernanceInvocationInput = Omit<AuthorityInvocationRequest, "governanceProposal" | "governanceConsequence"> & Readonly<{
  normativeActionKey: typeof authorityGovernanceActionKey;
  requestedAuthorityMode: "HUMAN_GATED";
  decisionId: string;
  delegationGrantId?: null;
}>;

export type GovernedPolicyVersionProposal = Readonly<{
  id: string;
  policyKey: string;
  expectedPredecessorPolicyVersionId: string;
  nextRevision: number;
  recordKind: "POLICY" | "REVOCATION";
  normativeActionKey: string;
  authorityMode: AuthorityMode;
  scopeSchemaKey: string;
  scopeSchemaVersion: string;
  definitionJson: string | null;
  contentSha256: string;
  priorDecisionDisposition: "PRESERVE" | "INVALIDATE";
  reasonCode: string | null;
  governanceDecisionId: string;
}>;

export type GovernedEligibilityRuleProposal = Readonly<{
  id: string;
  capabilityKey: string;
  contractVariantKey?: string | null;
  executorType: ExecutorType;
  verdict: "ELIGIBLE" | "CONDITIONAL" | "INELIGIBLE";
  conditionsSchemaKey: string | null;
  conditionsJson: string | null;
  ruleSha256: string;
}>;

export type GovernedEligibilityRuleSetVersionProposal = Readonly<{
  id: string;
  ruleSetKey: string;
  expectedPredecessorRuleSetVersionId: string;
  nextRevision: number;
  recordKind: "RULESET" | "DISABLED";
  contractCatalogRevision: string;
  /** Canonical digest of the complete version proposal, including childRules. */
  contentSha256: string;
  governanceDecisionId: string;
  childRules: readonly GovernedEligibilityRuleProposal[];
}>;

export type GovernedPolicyVersionCommitInput = Readonly<{
  invocation: GovernanceInvocationInput;
  proposal: GovernedPolicyVersionProposal;
}>;

export type GovernedEligibilityRuleSetVersionCommitInput = Readonly<{
  invocation: GovernanceInvocationInput;
  proposal: GovernedEligibilityRuleSetVersionProposal;
}>;

export type AuthorityGovernanceCommitResult =
  | Readonly<{ status: "COMMITTED"; canonicalRequestSha256: string }>
  | Readonly<{ status: "ALREADY_COMMITTED"; canonicalRequestSha256: string }>
  | Readonly<{ status: "DENIED"; reasonCode: string; canonicalRequestSha256?: string }>
  | Readonly<{ status: "UNRESOLVED"; reasonCode: string; canonicalRequestSha256?: string }>
  | Readonly<{ status: "DIGEST_MISMATCH"; persistedCanonicalRequestSha256: string }>
  | Readonly<{ status: "RECONCILIATION_REQUIRED"; reasonCode: string; canonicalRequestSha256: string }>;

export type AuthorityGovernanceWriter = Readonly<{
  commitGovernedPolicyVersion(input: GovernedPolicyVersionCommitInput): Promise<AuthorityGovernanceCommitResult>;
  commitGovernedEligibilityRuleSetVersion(input: GovernedEligibilityRuleSetVersionCommitInput): Promise<AuthorityGovernanceCommitResult>;
}>;

type GovernanceWriterOptions = Readonly<{
  createInvocationId?: () => string;
}>;

const sha256Pattern = /^[a-f0-9]{64}$/;

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function optionalText(value: unknown): value is string | null {
  return value === null || text(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("GOVERNANCE_CANONICAL_VALUE_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("GOVERNANCE_CANONICAL_VALUE_INVALID");
    ancestors.add(value);
    const result = `[${value.map((entry) => canonicalJson(entry, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new Error("GOVERNANCE_CANONICAL_VALUE_INVALID");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("GOVERNANCE_CANONICAL_VALUE_INVALID");
    ancestors.add(value);
    const record = value as Record<string, unknown>;
    const result = `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`).join(",")}}`;
    ancestors.delete(value);
    return result;
  }
  throw new Error("GOVERNANCE_CANONICAL_VALUE_INVALID");
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("GOVERNANCE_HASH_UNAVAILABLE");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

function canonicalJsonText(value: string | null): string | null {
  if (value === null) return null;
  if (!text(value)) throw new Error("GOVERNANCE_CANONICAL_JSON_INVALID");
  return canonicalJson(JSON.parse(value) as unknown);
}

type CanonicalChildRule = Readonly<{
  id: string;
  capabilityKey: string;
  contractVariantKey: string;
  executorType: ExecutorType;
  verdict: "ELIGIBLE" | "CONDITIONAL" | "INELIGIBLE";
  conditionsSchemaKey: string | null;
  conditionsJson: string | null;
  ruleSha256: string;
}>;

function canonicalRule(rule: GovernedEligibilityRuleProposal): CanonicalChildRule | null {
  const contractVariantKey = rule.contractVariantKey ?? "DEFAULT";
  if (!text(rule.id) || !text(rule.capabilityKey) || !text(contractVariantKey)
    || !["HUMAN_EXECUTOR", "DETERMINISTIC_SYSTEM", "REASONING_AI", "TOOL_ENABLED_AI"].includes(rule.executorType)
    || !["ELIGIBLE", "CONDITIONAL", "INELIGIBLE"].includes(rule.verdict)
    || !optionalText(rule.conditionsSchemaKey) || !optionalText(rule.conditionsJson) || !sha256Pattern.test(rule.ruleSha256)) return null;
  if ((rule.verdict === "CONDITIONAL" && (rule.conditionsSchemaKey === null || rule.conditionsJson === null))
    || (rule.verdict !== "CONDITIONAL" && (rule.conditionsSchemaKey !== null || rule.conditionsJson !== null))) return null;
  return { id: rule.id, capabilityKey: rule.capabilityKey, contractVariantKey, executorType: rule.executorType, verdict: rule.verdict, conditionsSchemaKey: rule.conditionsSchemaKey, conditionsJson: rule.conditionsJson, ruleSha256: rule.ruleSha256 };
}

function canonicalChildRules(rules: readonly GovernedEligibilityRuleProposal[]): CanonicalChildRule[] | null {
  if (rules.length > maxGovernanceRuleSetChildren) return null;
  const canonical = rules.map(canonicalRule);
  if (canonical.some((rule) => rule === null)) return null;
  const sorted = (canonical as CanonicalChildRule[]).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const ids = new Set<string>();
  const cells = new Set<string>();
  for (const rule of sorted) {
    const cell = `${rule.capabilityKey}\u0000${rule.contractVariantKey}\u0000${rule.executorType}`;
    if (ids.has(rule.id) || cells.has(cell)) return null;
    ids.add(rule.id);
    cells.add(cell);
  }
  return sorted;
}

/** Public because a caller must bind a RULESET proposal's parent hash before commit. */
export async function computeCanonicalEligibilityRuleSetChildSha256(
  rules: readonly GovernedEligibilityRuleProposal[],
): Promise<string> {
  const canonical = canonicalChildRules(rules);
  if (canonical === null) throw new Error("GOVERNANCE_RULE_SET_INVALID");
  return sha256(canonicalJson({ format: "authority-eligibility-child-set/v1", rules: canonical }));
}

/** Canonically binds every normative field of a governed policy proposal. */
export async function computeCanonicalAuthorityPolicyVersionContentSha256(
  proposal: Pick<GovernedPolicyVersionProposal,
    "policyKey" | "expectedPredecessorPolicyVersionId" | "nextRevision" | "recordKind" | "normativeActionKey" | "authorityMode" | "scopeSchemaKey" | "scopeSchemaVersion" | "definitionJson" | "priorDecisionDisposition" | "reasonCode">,
): Promise<string> {
  return sha256(canonicalJson({
    format: "authority-policy-version-content/v1",
    policyKey: proposal.policyKey,
    expectedPredecessorPolicyVersionId: proposal.expectedPredecessorPolicyVersionId,
    nextRevision: proposal.nextRevision,
    recordKind: proposal.recordKind,
    normativeActionKey: proposal.normativeActionKey,
    authorityMode: proposal.authorityMode,
    scopeSchemaKey: proposal.scopeSchemaKey,
    scopeSchemaVersion: proposal.scopeSchemaVersion,
    definitionJson: canonicalJsonText(proposal.definitionJson),
    priorDecisionDisposition: proposal.priorDecisionDisposition,
    reasonCode: proposal.reasonCode,
  }));
}

/** Canonically binds the ruleset parent fields and its complete canonical child set. */
export async function computeCanonicalEligibilityRuleSetVersionContentSha256(
  proposal: Pick<GovernedEligibilityRuleSetVersionProposal,
    "ruleSetKey" | "expectedPredecessorRuleSetVersionId" | "nextRevision" | "recordKind" | "contractCatalogRevision" | "childRules">,
): Promise<string> {
  const childRuleSetSha256 = await computeCanonicalEligibilityRuleSetChildSha256(proposal.childRules);
  return sha256(canonicalJson({
    format: "authority-eligibility-ruleset-version-content/v1",
    ruleSetKey: proposal.ruleSetKey,
    expectedPredecessorRuleSetVersionId: proposal.expectedPredecessorRuleSetVersionId,
    nextRevision: proposal.nextRevision,
    recordKind: proposal.recordKind,
    contractCatalogRevision: proposal.contractCatalogRevision,
    childRuleSetSha256,
  }));
}

async function policyBinding(proposal: GovernedPolicyVersionProposal): Promise<AuthorityGovernanceConsequenceBinding | null> {
  if (!text(proposal.id) || !text(proposal.policyKey) || !text(proposal.expectedPredecessorPolicyVersionId)
    || !positiveInteger(proposal.nextRevision) || !sha256Pattern.test(proposal.contentSha256)
    || !text(proposal.normativeActionKey) || !text(proposal.scopeSchemaKey) || !text(proposal.scopeSchemaVersion)
    || !text(proposal.governanceDecisionId) || !optionalText(proposal.definitionJson) || !optionalText(proposal.reasonCode)
    || !["POLICY_GOVERNED", "DELEGATED", "HUMAN_GATED"].includes(proposal.authorityMode)) return null;
  if ((proposal.recordKind === "POLICY" && (proposal.definitionJson === null || proposal.reasonCode !== null))
    || (proposal.recordKind === "REVOCATION" && (proposal.definitionJson !== null || proposal.priorDecisionDisposition !== "INVALIDATE" || proposal.reasonCode === null))) return null;
  if (proposal.recordKind !== "POLICY" && proposal.recordKind !== "REVOCATION") return null;
  if (proposal.priorDecisionDisposition !== "PRESERVE" && proposal.priorDecisionDisposition !== "INVALIDATE") return null;
  try {
    if (proposal.contentSha256 !== await computeCanonicalAuthorityPolicyVersionContentSha256(proposal)) return null;
  } catch {
    return null;
  }
  return {
    familyKind: "POLICY",
    successorId: proposal.id,
    policyKey: proposal.policyKey,
    expectedPredecessorId: proposal.expectedPredecessorPolicyVersionId,
    nextRevision: proposal.nextRevision,
    recordKind: proposal.recordKind,
    normativeActionKey: proposal.normativeActionKey,
    authorityMode: proposal.authorityMode,
    scopeSchemaKey: proposal.scopeSchemaKey,
    scopeSchemaVersion: proposal.scopeSchemaVersion,
    definitionJson: proposal.definitionJson,
    proposedContentSha256: proposal.contentSha256,
    priorDecisionDisposition: proposal.priorDecisionDisposition,
    reasonCode: proposal.reasonCode,
  };
}

async function ruleSetBinding(proposal: GovernedEligibilityRuleSetVersionProposal): Promise<AuthorityGovernanceConsequenceBinding | null> {
  if (!text(proposal.id) || !text(proposal.ruleSetKey) || !text(proposal.expectedPredecessorRuleSetVersionId)
    || !positiveInteger(proposal.nextRevision) || !text(proposal.contractCatalogRevision) || !sha256Pattern.test(proposal.contentSha256)
    || !text(proposal.governanceDecisionId) || (proposal.recordKind !== "RULESET" && proposal.recordKind !== "DISABLED")) return null;
  if (proposal.recordKind === "DISABLED" && proposal.childRules.length !== 0) return null;
  let childRuleSetSha256: string;
  try {
    childRuleSetSha256 = await computeCanonicalEligibilityRuleSetChildSha256(proposal.childRules);
    if (proposal.contentSha256 !== await computeCanonicalEligibilityRuleSetVersionContentSha256(proposal)) return null;
  } catch {
    return null;
  }
  return {
    familyKind: "ELIGIBILITY_RULESET", successorId: proposal.id, ruleSetKey: proposal.ruleSetKey,
    expectedPredecessorId: proposal.expectedPredecessorRuleSetVersionId, nextRevision: proposal.nextRevision,
    recordKind: proposal.recordKind, contractCatalogRevision: proposal.contractCatalogRevision,
    proposedContentSha256: proposal.contentSha256, childRuleSetSha256,
  };
}

function governanceRequest(invocation: GovernanceInvocationInput, binding: AuthorityGovernanceConsequenceBinding): AuthorityInvocationRequest | null {
  const familyKey = binding.familyKind === "POLICY" ? binding.policyKey : binding.ruleSetKey;
  const expectedSubjectType = binding.familyKind === "POLICY" ? "POLICY_FAMILY_DESCRIPTOR" : "ELIGIBILITY_RULESET_FAMILY_DESCRIPTOR";
  if (invocation.normativeActionKey !== authorityGovernanceActionKey || invocation.requestedAuthorityMode !== "HUMAN_GATED"
    || invocation.delegationGrantId !== undefined && invocation.delegationGrantId !== null
    || !text(invocation.decisionId)
    || invocation.subject.subjectType !== expectedSubjectType
    || invocation.subject.subjectId !== familyKey
    || invocation.subject.versionKind !== "EXACT_VERSION"
    || invocation.subject.versionToken !== binding.expectedPredecessorId) return null;
  return {
    ...invocation,
    governanceProposal: {
      familyKind: binding.familyKind,
      familyKey,
      expectedPredecessorId: binding.expectedPredecessorId,
      nextRevision: binding.nextRevision,
      recordKind: binding.recordKind,
      proposedContentSha256: binding.proposedContentSha256,
    },
    governanceConsequence: binding,
  };
}

async function firstRow(database: AuthorityGovernanceD1Database, query: string, ...values: unknown[]): Promise<Record<string, unknown> | null | undefined> {
  try {
    const row = await database.prepare(query).bind(...values).first<Record<string, unknown>>();
    return row === null ? null : typeof row === "object" ? row : undefined;
  } catch {
    return undefined;
  }
}

async function policyHeadStillExact(database: AuthorityGovernanceD1Database, proposal: GovernedPolicyVersionProposal): Promise<"MATCH" | "DENIED" | "UNRESOLVED"> {
  const row = await firstRow(database, `
SELECT "id", "policyKey", "revision", "recordKind"
FROM "AuthorityPolicyVersion"
WHERE "id" = ?
`, proposal.expectedPredecessorPolicyVersionId);
  if (row === undefined) return "UNRESOLVED";
  if (row === null || row.id !== proposal.expectedPredecessorPolicyVersionId || row.policyKey !== proposal.policyKey
    || row.recordKind !== "POLICY" || row.revision !== proposal.nextRevision - 1) return "DENIED";
  const successor = await firstRow(database, 'SELECT "id" FROM "AuthorityPolicyVersion" WHERE "predecessorPolicyVersionId" = ?', proposal.expectedPredecessorPolicyVersionId);
  if (successor === undefined) return "UNRESOLVED";
  return successor === null ? "MATCH" : "DENIED";
}

async function ruleSetHeadStillExact(database: AuthorityGovernanceD1Database, proposal: GovernedEligibilityRuleSetVersionProposal): Promise<"MATCH" | "DENIED" | "UNRESOLVED"> {
  const row = await firstRow(database, `
SELECT "id", "ruleSetKey", "revision", "recordKind"
FROM "ExecutorEligibilityRuleSetVersion"
WHERE "id" = ?
`, proposal.expectedPredecessorRuleSetVersionId);
  if (row === undefined) return "UNRESOLVED";
  if (row === null || row.id !== proposal.expectedPredecessorRuleSetVersionId || row.ruleSetKey !== proposal.ruleSetKey
    || row.recordKind !== "RULESET" || row.revision !== proposal.nextRevision - 1) return "DENIED";
  const successor = await firstRow(database, 'SELECT "id" FROM "ExecutorEligibilityRuleSetVersion" WHERE "predecessorRuleSetVersionId" = ?', proposal.expectedPredecessorRuleSetVersionId);
  if (successor === undefined) return "UNRESOLVED";
  return successor === null ? "MATCH" : "DENIED";
}

function equalPolicyRow(row: Record<string, unknown>, proposal: GovernedPolicyVersionProposal): boolean {
  return row.id === proposal.id && row.policyKey === proposal.policyKey && row.revision === proposal.nextRevision
    && row.predecessorPolicyVersionId === proposal.expectedPredecessorPolicyVersionId && row.recordKind === proposal.recordKind
    && row.normativeActionKey === proposal.normativeActionKey && row.authorityMode === proposal.authorityMode
    && row.scopeSchemaKey === proposal.scopeSchemaKey && row.scopeSchemaVersion === proposal.scopeSchemaVersion
    && row.definitionJson === proposal.definitionJson && row.contentSha256 === proposal.contentSha256
    && row.priorDecisionDisposition === proposal.priorDecisionDisposition && row.governanceDecisionId === proposal.governanceDecisionId
    && row.reasonCode === proposal.reasonCode;
}

async function policyConsequenceExact(database: AuthorityGovernanceD1Database, proposal: GovernedPolicyVersionProposal): Promise<boolean | null> {
  const row = await firstRow(database, `
SELECT "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId", "reasonCode"
FROM "AuthorityPolicyVersion" WHERE "id" = ?
`, proposal.id);
  return row === undefined ? null : row !== null && equalPolicyRow(row, proposal);
}

function equalRuleSetRow(row: Record<string, unknown>, proposal: GovernedEligibilityRuleSetVersionProposal): boolean {
  return row.id === proposal.id && row.ruleSetKey === proposal.ruleSetKey && row.revision === proposal.nextRevision
    && row.predecessorRuleSetVersionId === proposal.expectedPredecessorRuleSetVersionId && row.recordKind === proposal.recordKind
    && row.contractCatalogRevision === proposal.contractCatalogRevision && row.contentSha256 === proposal.contentSha256
    && row.governanceDecisionId === proposal.governanceDecisionId;
}

async function ruleSetConsequenceExact(database: AuthorityGovernanceD1Database, proposal: GovernedEligibilityRuleSetVersionProposal): Promise<boolean | null> {
  const row = await firstRow(database, `
SELECT "id", "ruleSetKey", "revision", "predecessorRuleSetVersionId", "recordKind", "contractCatalogRevision", "contentSha256", "governanceDecisionId"
FROM "ExecutorEligibilityRuleSetVersion" WHERE "id" = ?
`, proposal.id);
  if (row === undefined) return null;
  if (row === null || !equalRuleSetRow(row, proposal)) return false;
  const result = await database.prepare(`
SELECT "id", "capabilityKey", "contractVariantKey", "executorType", "verdict", "conditionsSchemaKey", "conditionsJson", "ruleSha256"
FROM "ExecutorEligibilityRule" WHERE "ruleSetVersionId" = ? ORDER BY "id" ASC
`).bind(proposal.id).all<Record<string, unknown>>().catch(() => null);
  if (result === null || !Array.isArray(result.results)) return null;
  const expected = proposal.recordKind === "RULESET" ? canonicalChildRules(proposal.childRules) : [];
  if (expected === null || result.results.length !== expected.length) return false;
  const actual = result.results.map((rule) => canonicalRule({
    id: String(rule.id ?? ""), capabilityKey: String(rule.capabilityKey ?? ""), contractVariantKey: typeof rule.contractVariantKey === "string" ? rule.contractVariantKey : null,
    executorType: rule.executorType as ExecutorType, verdict: rule.verdict as GovernedEligibilityRuleProposal["verdict"],
    conditionsSchemaKey: typeof rule.conditionsSchemaKey === "string" ? rule.conditionsSchemaKey : null,
    conditionsJson: typeof rule.conditionsJson === "string" ? rule.conditionsJson : null, ruleSha256: String(rule.ruleSha256 ?? ""),
  }));
  if (actual.some((rule) => rule === null)) return false;
  const actualSorted = (actual as CanonicalChildRule[]).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return canonicalJson(actualSorted) === canonicalJson(expected);
}

function invocationStatement(database: AuthorityGovernanceD1Database, id: string, fields: Awaited<ReturnType<typeof prepareAuthorizedAuthorityInvocation>>["fields"]): AuthorityPreparedStatement {
  return database.prepare(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "contractVariantKey", "executorActorId", "executorType", "subjectRefId", "caseSubjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "decisionId", "delegationGrantId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(id, fields.invocationKey, fields.canonicalRequestSha256, fields.normativeActionKey, fields.capabilityKey, fields.contractVariantKey, fields.executorActorId, fields.executorType, fields.subjectRefId, fields.caseSubjectRefId, fields.policyVersionId, fields.eligibilityRuleSetVersionId, fields.eligibilityRuleId, fields.decisionId, fields.delegationGrantId, fields.outcome, fields.lineageSha256, fields.evaluatedAt);
}

function policyStatement(database: AuthorityGovernanceD1Database, proposal: GovernedPolicyVersionProposal): AuthorityPreparedStatement {
  return database.prepare(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId", "reasonCode"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(proposal.id, proposal.policyKey, proposal.nextRevision, proposal.expectedPredecessorPolicyVersionId, proposal.recordKind, proposal.normativeActionKey, proposal.authorityMode, proposal.scopeSchemaKey, proposal.scopeSchemaVersion, proposal.definitionJson, proposal.contentSha256, proposal.priorDecisionDisposition, proposal.governanceDecisionId, proposal.reasonCode);
}

function ruleSetStatement(database: AuthorityGovernanceD1Database, proposal: GovernedEligibilityRuleSetVersionProposal): AuthorityPreparedStatement {
  return database.prepare(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" (
  "id", "ruleSetKey", "revision", "predecessorRuleSetVersionId", "recordKind", "contractCatalogRevision", "contentSha256", "governanceDecisionId"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).bind(proposal.id, proposal.ruleSetKey, proposal.nextRevision, proposal.expectedPredecessorRuleSetVersionId, proposal.recordKind, proposal.contractCatalogRevision, proposal.contentSha256, proposal.governanceDecisionId);
}

function childRuleStatement(database: AuthorityGovernanceD1Database, ruleSetVersionId: string, rule: CanonicalChildRule): AuthorityPreparedStatement {
  return database.prepare(`
INSERT INTO "ExecutorEligibilityRule" (
  "id", "ruleSetVersionId", "capabilityKey", "contractVariantKey", "executorType", "verdict", "conditionsSchemaKey", "conditionsJson", "ruleSha256"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(rule.id, ruleSetVersionId, rule.capabilityKey, rule.contractVariantKey, rule.executorType, rule.verdict, rule.conditionsSchemaKey, rule.conditionsJson, rule.ruleSha256);
}

export function classifyAuthorityGovernanceBatchFailure(error: unknown, digest: string): AuthorityGovernanceCommitResult {
  const message = error instanceof Error ? error.message : "";
  if (/AUTHORITY_|ELIGIBILITY_|UNIQUE constraint failed|CHECK constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed/i.test(message)) return { status: "DENIED", reasonCode: "GOVERNANCE_BATCH_REJECTED", canonicalRequestSha256: digest };
  return { status: "UNRESOLVED", reasonCode: "GOVERNANCE_BATCH_UNKNOWN", canonicalRequestSha256: digest };
}

async function reconcileBeforeCommit(
  database: AuthorityGovernanceD1Database,
  request: AuthorityInvocationRequest,
  exact: () => Promise<boolean | null>,
): Promise<AuthorityGovernanceCommitResult | null> {
  let digest: string;
  try {
    const subject = await canonicalizeAuthoritySubject(request.subject);
    const scope = request.caseOrScopeSubject === undefined || request.caseOrScopeSubject === null
      ? null
      : await canonicalizeAuthoritySubject(request.caseOrScopeSubject);
    digest = await computeCanonicalAuthorityRequestSha256({
      normativeActionKey: request.normativeActionKey,
      capabilityKey: request.capabilityKey,
      contractVariantKey: request.contractVariantKey,
      executorActorId: request.executorActorId,
      executorType: request.executorType,
      subjectCanonicalKey: subject.canonicalKey,
      caseOrScopeCanonicalKey: scope?.canonicalKey ?? null,
      requestedAuthorityMode: request.requestedAuthorityMode,
      policyKey: request.policyKey,
      decisionId: request.decisionId,
      delegationGrantId: request.delegationGrantId,
      requestedConsequenceDescriptorKey: request.requestedConsequenceDescriptorKey,
      requestedConsequenceSchemaKey: request.requestedConsequenceSchemaKey,
      governanceConsequence: request.governanceConsequence,
    });
  } catch {
    return { status: "UNRESOLVED", reasonCode: "CANONICAL_REQUEST_UNRESOLVED" };
  }
  const reconciliation = await reconcileAuthorityInvocation(database, request.invocationKey, digest);
  if (reconciliation.status === "NOT_FOUND") return null;
  if (reconciliation.status === "DIGEST_MISMATCH") return { status: "DIGEST_MISMATCH", persistedCanonicalRequestSha256: reconciliation.persistedCanonicalRequestSha256 };
  if (reconciliation.status === "CORRUPT") return { status: "UNRESOLVED", reasonCode: reconciliation.reasonCode, canonicalRequestSha256: digest };
  const consequence = await exact();
  if (consequence === true) return { status: "ALREADY_COMMITTED", canonicalRequestSha256: digest };
  if (consequence === null) return { status: "UNRESOLVED", reasonCode: "CONSEQUENCE_RECONCILIATION_READ_FAILED", canonicalRequestSha256: digest };
  return { status: "RECONCILIATION_REQUIRED", reasonCode: "INVOCATION_CONSEQUENCE_NOT_EXACT", canonicalRequestSha256: digest };
}

async function revalidateAndPrepare(
  database: AuthorityGovernanceD1Database,
  request: AuthorityInvocationRequest,
  head: () => Promise<"MATCH" | "DENIED" | "UNRESOLVED">,
): Promise<AuthorityGovernanceCommitResult | Awaited<ReturnType<typeof prepareAuthorizedAuthorityInvocation>>> {
  const exactHead = await head();
  if (exactHead === "UNRESOLVED") return { status: "UNRESOLVED", reasonCode: "TARGET_HEAD_READ_FAILED" };
  if (exactHead === "DENIED") return { status: "DENIED", reasonCode: "TARGET_HEAD_NOT_EXACT" };
  const evaluation = await createAuthorityEvaluator(database).evaluateInvocation(request);
  if (evaluation.outcome === "DENIED") return { status: "DENIED", reasonCode: evaluation.reasonCode, canonicalRequestSha256: evaluation.canonicalRequestSha256 };
  if (evaluation.outcome === "UNRESOLVED") return { status: "UNRESOLVED", reasonCode: evaluation.reasonCode, canonicalRequestSha256: evaluation.canonicalRequestSha256 };
  return prepareAuthorizedAuthorityInvocation(request, evaluation);
}

function isResult(value: AuthorityGovernanceCommitResult | Awaited<ReturnType<typeof prepareAuthorizedAuthorityInvocation>>): value is AuthorityGovernanceCommitResult {
  return "status" in value;
}

/** Creates only the two concrete, phase-owned TR-03D governance writers. */
export function createAuthorityGovernanceWriter(
  database: AuthorityGovernanceD1Database,
  options: GovernanceWriterOptions = {},
): AuthorityGovernanceWriter {
  const createInvocationId = options.createInvocationId ?? (() => crypto.randomUUID());

  async function commitGovernedPolicyVersion(input: GovernedPolicyVersionCommitInput): Promise<AuthorityGovernanceCommitResult> {
    const binding = await policyBinding(input.proposal);
    if (binding === null || input.invocation.decisionId !== input.proposal.governanceDecisionId) return { status: "DENIED", reasonCode: "POLICY_PROPOSAL_INVALID" };
    const request = governanceRequest(input.invocation, binding);
    if (request === null) return { status: "DENIED", reasonCode: "GOVERNANCE_REQUEST_MISMATCH" };
    const reconciliation = await reconcileBeforeCommit(database, request, () => policyConsequenceExact(database, input.proposal));
    if (reconciliation !== null) return reconciliation;
    const prepared = await revalidateAndPrepare(database, request, () => policyHeadStillExact(database, input.proposal));
    if (isResult(prepared)) return prepared;
    try {
      await database.batch([invocationStatement(database, createInvocationId(), prepared.fields), policyStatement(database, input.proposal)]);
      return { status: "COMMITTED", canonicalRequestSha256: prepared.fields.canonicalRequestSha256 };
    } catch (error) {
      return classifyAuthorityGovernanceBatchFailure(error, prepared.fields.canonicalRequestSha256);
    }
  }

  async function commitGovernedEligibilityRuleSetVersion(input: GovernedEligibilityRuleSetVersionCommitInput): Promise<AuthorityGovernanceCommitResult> {
    const binding = await ruleSetBinding(input.proposal);
    if (binding === null || input.invocation.decisionId !== input.proposal.governanceDecisionId) return { status: "DENIED", reasonCode: "RULESET_PROPOSAL_INVALID" };
    const request = governanceRequest(input.invocation, binding);
    if (request === null) return { status: "DENIED", reasonCode: "GOVERNANCE_REQUEST_MISMATCH" };
    const reconciliation = await reconcileBeforeCommit(database, request, () => ruleSetConsequenceExact(database, input.proposal));
    if (reconciliation !== null) return reconciliation;
    const prepared = await revalidateAndPrepare(database, request, () => ruleSetHeadStillExact(database, input.proposal));
    if (isResult(prepared)) return prepared;
    const children = input.proposal.recordKind === "RULESET" ? canonicalChildRules(input.proposal.childRules) : [];
    if (children === null) return { status: "DENIED", reasonCode: "RULESET_CHILD_SET_INVALID", canonicalRequestSha256: prepared.fields.canonicalRequestSha256 };
    try {
      await database.batch([
        invocationStatement(database, createInvocationId(), prepared.fields),
        ruleSetStatement(database, input.proposal),
        ...children.map((child) => childRuleStatement(database, input.proposal.id, child)),
      ]);
      return { status: "COMMITTED", canonicalRequestSha256: prepared.fields.canonicalRequestSha256 };
    } catch (error) {
      return classifyAuthorityGovernanceBatchFailure(error, prepared.fields.canonicalRequestSha256);
    }
  }

  return { commitGovernedPolicyVersion, commitGovernedEligibilityRuleSetVersion };
}
