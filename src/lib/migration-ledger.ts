/**
 * Native-D1 migration ledger infrastructure. This module deliberately knows
 * nothing about Legacy Lead, Business, Candidate, or Case migration policy.
 */

export const migrationLedgerStates = [
  "PENDING",
  "APPLIED",
  "SKIPPED",
  "AMBIGUOUS",
  "FAILED",
  "RECONCILE_REQUIRED",
] as const;

export type MigrationLedgerState = (typeof migrationLedgerStates)[number];
export type MigrationTerminalState = Exclude<MigrationLedgerState, "PENDING">;

export const migrationConsequenceKinds = [
  "CREATED",
  "ASSOCIATED",
  "VERIFIED_PREEXISTING",
] as const;

export type MigrationConsequenceKind = (typeof migrationConsequenceKinds)[number];

export type MigrationLedgerPreparedStatement = {
  bind(...values: unknown[]): MigrationLedgerPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

export type MigrationLedgerD1Database = {
  prepare(query: string): MigrationLedgerPreparedStatement;
  batch(statements: readonly MigrationLedgerPreparedStatement[]): Promise<Array<{ meta?: { changes?: number } }>>;
};

export type MigrationLogicalIdentity = Readonly<{
  sourceSystem: string;
  sourceType: string;
  sourceId: string;
  targetResponsibility: string;
  ruleVersion: string;
}>;

export type MigrationUnitRecord = Readonly<{
  id: string;
  logicalKeySha256: string;
  sourceSystem: string;
  sourceType: string;
  sourceId: string;
  targetResponsibility: string;
  ruleVersion: string;
  state: MigrationLedgerState;
  lastFingerprint: string;
  fingerprintFormat: string;
  createdAt: string;
  updatedAt: string;
}>;

export type MigrationAttemptRecord = Readonly<{
  id: string;
  migrationUnitId: string;
  state: MigrationLedgerState;
  sourceFingerprint: string;
  fingerprintFormat: string;
  sourceProvenanceJson: string;
  reasonCode: string | null;
  outcomeEvidenceJson: string | null;
  failureEvidenceJson: string | null;
  startedAt: string;
  completedAt: string | null;
}>;

export type MigrationTargetRefRecord = Readonly<{
  id: string;
  migrationUnitId: string;
  establishedByAttemptId: string;
  targetType: string;
  targetKeyFormat: string;
  targetKey: string;
  consequenceKind: MigrationConsequenceKind;
  createdAt: string;
}>;

export type MigrationTargetKey =
  | Readonly<{ format: "uuid/v1"; uuid: string }>
  | Readonly<{ format: "canonical-json/v1"; values: readonly string[] }>;

export type MigrationTargetRefDescriptor = Readonly<{
  targetType: string;
  targetKey: MigrationTargetKey;
  consequenceKind: MigrationConsequenceKind;
}>;

export type ReserveMigrationAttemptInput = Readonly<{
  identity: MigrationLogicalIdentity;
  sourceFingerprint: string;
  fingerprintFormat: string;
  sourceProvenance: unknown;
  verifyAppliedTargetRefs?: MigrationTargetRefVerifier;
}>;

export type MigrationTargetVerificationResult =
  | Readonly<{
      status: "VERIFIED";
      verifiedTargetRefIds: readonly string[];
      evidence?: unknown;
    }>
  | Readonly<{
      status: "NOT_VERIFIED";
      reasonCode: string;
      evidence?: unknown;
    }>;

export type MigrationTargetRefVerifier = (input: Readonly<{
  database: MigrationLedgerD1Database;
  unit: MigrationUnitRecord;
  targetRefs: readonly MigrationTargetRefRecord[];
}>) => Promise<MigrationTargetVerificationResult>;

export type MigrationReservation =
  | Readonly<{ kind: "RESERVED"; unit: MigrationUnitRecord; attempt: MigrationAttemptRecord }>
  | Readonly<{ kind: "PENDING"; unit: MigrationUnitRecord; attempt: MigrationAttemptRecord }>
  | Readonly<{ kind: "IDEMPOTENT_APPLIED"; unit: MigrationUnitRecord; targetRefs: readonly MigrationTargetRefRecord[] }>
  | Readonly<{ kind: "RECONCILIATION_REQUIRED"; unit: MigrationUnitRecord; targetRefs: readonly MigrationTargetRefRecord[] }>;

export type FinalizeMigrationWithoutTargetInput = Readonly<{
  migrationUnitId: string;
  migrationAttemptId: string;
  state: Exclude<MigrationTerminalState, "APPLIED">;
  reasonCode?: string;
  outcomeEvidence?: unknown;
  failureEvidence?: unknown;
}>;

export type ApplyMigrationWithTargetsInput = Readonly<{
  migrationUnitId: string;
  migrationAttemptId: string;
  targetMutations: readonly MigrationLedgerPreparedStatement[];
  targetRefs: readonly MigrationTargetRefDescriptor[];
  reasonCode?: string;
  outcomeEvidence?: unknown;
}>;

export type ReconcileMigrationAppliedWithVerificationInput = Readonly<{
  migrationUnitId: string;
  migrationAttemptId: string;
  verifyTargetRefs: MigrationTargetRefVerifier;
}>;

export type MigrationAppliedReconciliationResult =
  | Readonly<{ kind: "APPLIED"; attempt: MigrationAttemptRecord }>
  | Readonly<{ kind: "NOT_VERIFIED"; reasonCode: string }>;

export type MigrationLedgerWriter = Readonly<{
  reserveMigrationAttempt(input: ReserveMigrationAttemptInput): Promise<MigrationReservation>;
  finalizeMigrationWithoutTarget(input: FinalizeMigrationWithoutTargetInput): Promise<MigrationAttemptRecord>;
  reconcileMigrationAppliedWithVerification(
    input: ReconcileMigrationAppliedWithVerificationInput,
  ): Promise<MigrationAppliedReconciliationResult>;
  applyMigrationWithTargetsAtomically(input: ApplyMigrationWithTargetsInput): Promise<MigrationAttemptRecord>;
  getMigrationUnit(identity: MigrationLogicalIdentity): Promise<MigrationUnitRecord | null>;
  getMigrationTargetRefs(migrationUnitId: string): Promise<MigrationTargetRefRecord[]>;
}>;

export class MigrationLedgerError extends Error {
  constructor(public readonly code:
    | "INVALID_LOGICAL_IDENTITY"
    | "INVALID_FINGERPRINT"
    | "INVALID_EVIDENCE"
    | "INVALID_TARGET_KEY"
    | "INVALID_RESERVATION"
    | "RESERVATION_FAILED"
    | "FINALIZATION_FAILED"
    | "ATOMIC_APPLY_FAILED"
    | "LEDGER_INTEGRITY_ERROR") {
    super(code);
  }
}

type WriterOptions = Readonly<{
  now?: () => Date;
  createId?: () => string;
}>;

type NormalizedTargetRef = Readonly<{
  targetType: string;
  targetKeyFormat: "uuid/v1" | "canonical-json/v1";
  targetKey: string;
  consequenceKind: MigrationConsequenceKind;
}>;

type ValidatedTargetVerification =
  | Readonly<{ status: "VERIFIED"; verifiedTargetRefIds: readonly string[]; evidence?: unknown }>
  | Readonly<{ status: "NOT_VERIFIED"; reasonCode: string }>;

const logicalKeyVersion = "standloud-migration-unit/v1";
const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxEvidenceCharacters = 32_768;
const terminalStates = new Set<MigrationTerminalState>([
  "APPLIED",
  "SKIPPED",
  "AMBIGUOUS",
  "FAILED",
  "RECONCILE_REQUIRED",
]);
const consequenceKinds = new Set<MigrationConsequenceKind>(migrationConsequenceKinds);

function assertText(value: string, code: "INVALID_LOGICAL_IDENTITY" | "INVALID_EVIDENCE" | "INVALID_TARGET_KEY") {
  if (value.length === 0 || value.trim().length === 0 || value.includes("\0")) {
    throw new MigrationLedgerError(code);
  }
}

function assertLogicalIdentity(identity: MigrationLogicalIdentity) {
  assertText(identity.sourceSystem, "INVALID_LOGICAL_IDENTITY");
  assertText(identity.sourceType, "INVALID_LOGICAL_IDENTITY");
  assertText(identity.sourceId, "INVALID_LOGICAL_IDENTITY");
  assertText(identity.targetResponsibility, "INVALID_LOGICAL_IDENTITY");
  assertText(identity.ruleVersion, "INVALID_LOGICAL_IDENTITY");
}

function assertFingerprint(value: string) {
  if (!sha256Pattern.test(value)) throw new MigrationLedgerError("INVALID_FINGERPRINT");
}

function assertFingerprintFormat(value: string) {
  assertText(value, "INVALID_EVIDENCE");
}

function assertReasonCode(value: string | undefined) {
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 256 || value.includes("\0")) {
    throw new MigrationLedgerError("INVALID_EVIDENCE");
  }
  return value;
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MigrationLedgerError("INVALID_EVIDENCE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new MigrationLedgerError("INVALID_EVIDENCE");
    ancestors.add(value);
    const serialized = `[${value.map((entry) => canonicalJson(entry, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return serialized;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new MigrationLedgerError("INVALID_EVIDENCE");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new MigrationLedgerError("INVALID_EVIDENCE");
    ancestors.add(value);
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const serialized = `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`).join(",")}}`;
    ancestors.delete(value);
    return serialized;
  }
  throw new MigrationLedgerError("INVALID_EVIDENCE");
}

function serializeEvidence(value: unknown, required: boolean): string | null {
  if (value === undefined) {
    if (required) throw new MigrationLedgerError("INVALID_EVIDENCE");
    return null;
  }
  const serialized = canonicalJson(value);
  if (serialized.length > maxEvidenceCharacters) throw new MigrationLedgerError("INVALID_EVIDENCE");
  return serialized;
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new MigrationLedgerError("LEDGER_INTEGRITY_ERROR");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

/** Hashes exactly the frozen logical-unit byte contract. */
export async function computeMigrationLogicalKey(identity: MigrationLogicalIdentity): Promise<string> {
  assertLogicalIdentity(identity);
  return sha256Hex([
    logicalKeyVersion,
    identity.sourceSystem,
    identity.sourceType,
    identity.sourceId,
    identity.targetResponsibility,
    identity.ruleVersion,
  ].join("\0"));
}

/** Generic source-fingerprint primitive; callers own the canonical source material. */
export async function computeMigrationSourceFingerprint(canonicalMaterial: string): Promise<string> {
  if (canonicalMaterial.length === 0) throw new MigrationLedgerError("INVALID_FINGERPRINT");
  return sha256Hex(canonicalMaterial);
}

export function canonicalUuidTargetKey(value: string): string {
  if (!uuidPattern.test(value)) throw new MigrationLedgerError("INVALID_TARGET_KEY");
  return value.toLowerCase();
}

export function canonicalJsonTargetKey(values: readonly string[]): string {
  if (values.length === 0 || values.some((value) => value.length === 0 || value.includes("\0"))) {
    throw new MigrationLedgerError("INVALID_TARGET_KEY");
  }
  return JSON.stringify([...values]);
}

function normalizeTargetRef(descriptor: MigrationTargetRefDescriptor): NormalizedTargetRef {
  assertText(descriptor.targetType, "INVALID_TARGET_KEY");
  if (!consequenceKinds.has(descriptor.consequenceKind)) throw new MigrationLedgerError("INVALID_TARGET_KEY");
  if (descriptor.targetKey.format === "uuid/v1") {
    return {
      targetType: descriptor.targetType,
      targetKeyFormat: "uuid/v1",
      targetKey: canonicalUuidTargetKey(descriptor.targetKey.uuid),
      consequenceKind: descriptor.consequenceKind,
    };
  }
  if (descriptor.targetKey.format === "canonical-json/v1") {
    return {
      targetType: descriptor.targetType,
      targetKeyFormat: "canonical-json/v1",
      targetKey: canonicalJsonTargetKey(descriptor.targetKey.values),
      consequenceKind: descriptor.consequenceKind,
    };
  }
  throw new MigrationLedgerError("INVALID_TARGET_KEY");
}

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new MigrationLedgerError("LEDGER_INTEGRITY_ERROR");
  }
  return globalThis.crypto.randomUUID();
}

function timestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new MigrationLedgerError("LEDGER_INTEGRITY_ERROR");
  return value.toISOString();
}

function requirePositiveChange(results: Array<{ meta?: { changes?: number } }>, index: number, code: "RESERVATION_FAILED" | "FINALIZATION_FAILED" | "ATOMIC_APPLY_FAILED") {
  // D1 may include an AFTER-trigger projection update in the statement's
  // change count. Zero is the unsafe CAS result; any positive count is valid.
  const changes = results[index]?.meta?.changes;
  if (typeof changes !== "number" || changes < 1) throw new MigrationLedgerError(code);
}

function mapUnit(record: Record<string, unknown> | null): MigrationUnitRecord | null {
  if (record === null) return null;
  return record as unknown as MigrationUnitRecord;
}

function mapAttempt(record: Record<string, unknown> | null): MigrationAttemptRecord | null {
  if (record === null) return null;
  return record as unknown as MigrationAttemptRecord;
}

function mapTargetRefs(records: Record<string, unknown>[]): MigrationTargetRefRecord[] {
  return records as unknown as MigrationTargetRefRecord[];
}

const selectUnitByKeySql = `
SELECT "id", "logicalKeySha256", "sourceSystem", "sourceType", "sourceId", "targetResponsibility", "ruleVersion", "state", "lastFingerprint", "fingerprintFormat", "createdAt", "updatedAt"
FROM "MigrationUnit"
WHERE "logicalKeySha256" = ?
`;

const selectPendingAttemptSql = `
SELECT "id", "migrationUnitId", "state", "sourceFingerprint", "fingerprintFormat", "sourceProvenanceJson", "reasonCode", "outcomeEvidenceJson", "failureEvidenceJson", "startedAt", "completedAt"
FROM "MigrationAttempt"
WHERE "migrationUnitId" = ? AND "state" = 'PENDING'
`;

const selectAttemptSql = `
SELECT "id", "migrationUnitId", "state", "sourceFingerprint", "fingerprintFormat", "sourceProvenanceJson", "reasonCode", "outcomeEvidenceJson", "failureEvidenceJson", "startedAt", "completedAt"
FROM "MigrationAttempt"
WHERE "id" = ? AND "migrationUnitId" = ?
`;

const selectTargetRefsSql = `
SELECT "id", "migrationUnitId", "establishedByAttemptId", "targetType", "targetKeyFormat", "targetKey", "consequenceKind", "createdAt"
FROM "MigrationTargetRef"
WHERE "migrationUnitId" = ?
ORDER BY "createdAt" ASC, "id" ASC
`;

function sameIdentity(unit: MigrationUnitRecord, identity: MigrationLogicalIdentity): boolean {
  return unit.sourceSystem === identity.sourceSystem
    && unit.sourceType === identity.sourceType
    && unit.sourceId === identity.sourceId
    && unit.targetResponsibility === identity.targetResponsibility
    && unit.ruleVersion === identity.ruleVersion;
}

async function readUnit(database: MigrationLedgerD1Database, logicalKeySha256: string): Promise<MigrationUnitRecord | null> {
  return mapUnit(await database.prepare(selectUnitByKeySql).bind(logicalKeySha256).first());
}

async function readUnitById(database: MigrationLedgerD1Database, migrationUnitId: string): Promise<MigrationUnitRecord | null> {
  return mapUnit(await database.prepare(`
SELECT "id", "logicalKeySha256", "sourceSystem", "sourceType", "sourceId", "targetResponsibility", "ruleVersion", "state", "lastFingerprint", "fingerprintFormat", "createdAt", "updatedAt"
FROM "MigrationUnit"
WHERE "id" = ?
`).bind(migrationUnitId).first());
}

async function readAttempt(
  database: MigrationLedgerD1Database,
  migrationAttemptId: string,
  migrationUnitId: string,
): Promise<MigrationAttemptRecord | null> {
  return mapAttempt(await database.prepare(selectAttemptSql).bind(migrationAttemptId, migrationUnitId).first());
}

async function readPendingAttempt(database: MigrationLedgerD1Database, migrationUnitId: string): Promise<MigrationAttemptRecord | null> {
  return mapAttempt(await database.prepare(selectPendingAttemptSql).bind(migrationUnitId).first());
}

async function readTargetRefs(database: MigrationLedgerD1Database, migrationUnitId: string): Promise<MigrationTargetRefRecord[]> {
  const result = await database.prepare(selectTargetRefsSql).bind(migrationUnitId).all();
  return mapTargetRefs(result.results);
}

function assertReservationInput(input: ReserveMigrationAttemptInput) {
  assertLogicalIdentity(input.identity);
  assertFingerprint(input.sourceFingerprint);
  assertFingerprintFormat(input.fingerprintFormat);
  return serializeEvidence(input.sourceProvenance, true)!;
}

function verificationEvidence(verification: Extract<ValidatedTargetVerification, { status: "VERIFIED" }>) {
  return {
    verificationKind: "migration-target-material-verification/v1",
    verifiedTargetRefIds: verification.verifiedTargetRefIds,
    targetEvidence: verification.evidence ?? null,
  };
}

async function verifyAllTargetRefs(
  database: MigrationLedgerD1Database,
  unit: MigrationUnitRecord,
  targetRefs: readonly MigrationTargetRefRecord[],
  verifier: MigrationTargetRefVerifier | undefined,
): Promise<ValidatedTargetVerification> {
  if (verifier === undefined) return { status: "NOT_VERIFIED", reasonCode: "TARGET_VERIFIER_REQUIRED" };
  if (targetRefs.length === 0) return { status: "NOT_VERIFIED", reasonCode: "TARGET_REF_REQUIRED" };

  let result: MigrationTargetVerificationResult;
  try {
    result = await verifier({ database, unit, targetRefs });
  } catch {
    return { status: "NOT_VERIFIED", reasonCode: "TARGET_VERIFIER_FAILED" };
  }

  if (typeof result !== "object" || result === null || !("status" in result)) {
    return { status: "NOT_VERIFIED", reasonCode: "TARGET_VERIFIER_RESULT_INVALID" };
  }
  if (result.status === "NOT_VERIFIED") {
    if (typeof result.reasonCode !== "string" || result.reasonCode.length === 0 || result.reasonCode.length > 256 || result.reasonCode.includes("\0")) {
      return { status: "NOT_VERIFIED", reasonCode: "TARGET_VERIFIER_RESULT_INVALID" };
    }
    return { status: "NOT_VERIFIED", reasonCode: result.reasonCode };
  }
  if (result.status !== "VERIFIED" || !Array.isArray(result.verifiedTargetRefIds)
    || result.verifiedTargetRefIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return { status: "NOT_VERIFIED", reasonCode: "TARGET_VERIFIER_RESULT_INVALID" };
  }

  const requiredIds = targetRefs.map((targetRef) => targetRef.id);
  const verifiedIds = result.verifiedTargetRefIds;
  const verifiedIdSet = new Set(verifiedIds);
  if (verifiedIdSet.size !== verifiedIds.length
    || verifiedIds.length !== requiredIds.length
    || requiredIds.some((id) => !verifiedIdSet.has(id))) {
    return { status: "NOT_VERIFIED", reasonCode: "TARGET_REF_COVERAGE_INVALID" };
  }
  return {
    status: "VERIFIED",
    // Preserve the persisted Unit order rather than caller-provided ordering.
    verifiedTargetRefIds: requiredIds,
    ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
  };
}

/**
 * Constructs the only normal mutation API for the operational ledger. It has
 * no route/UI surface and accepts target changes only as prepared D1 statements.
 */
export function createMigrationLedgerWriter(
  database: MigrationLedgerD1Database,
  options: WriterOptions = {},
): MigrationLedgerWriter {
  const now = options.now ?? (() => new Date());
  const nextId = options.createId ?? createUuid;

  async function getMigrationUnit(identity: MigrationLogicalIdentity): Promise<MigrationUnitRecord | null> {
    const logicalKeySha256 = await computeMigrationLogicalKey(identity);
    const unit = await readUnit(database, logicalKeySha256);
    if (unit !== null && !sameIdentity(unit, identity)) throw new MigrationLedgerError("LEDGER_INTEGRITY_ERROR");
    return unit;
  }

  async function reserveMigrationAttempt(input: ReserveMigrationAttemptInput): Promise<MigrationReservation> {
    const sourceProvenanceJson = assertReservationInput(input);
    const logicalKeySha256 = await computeMigrationLogicalKey(input.identity);
    let unit = await readUnit(database, logicalKeySha256);

    if (unit !== null && !sameIdentity(unit, input.identity)) {
      throw new MigrationLedgerError("LEDGER_INTEGRITY_ERROR");
    }

    if (unit === null) {
      const unitId = nextId();
      const attemptId = nextId();
      const startedAt = timestamp(now);
      try {
        const results = await database.batch([
          database.prepare(`
INSERT INTO "MigrationUnit" (
  "id", "logicalKeySha256", "sourceSystem", "sourceType", "sourceId", "targetResponsibility", "ruleVersion",
  "state", "lastFingerprint", "fingerprintFormat", "createdAt", "updatedAt"
) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
`).bind(
            unitId,
            logicalKeySha256,
            input.identity.sourceSystem,
            input.identity.sourceType,
            input.identity.sourceId,
            input.identity.targetResponsibility,
            input.identity.ruleVersion,
            input.sourceFingerprint,
            input.fingerprintFormat,
            startedAt,
            startedAt,
          ),
          database.prepare(`
INSERT INTO "MigrationAttempt" (
  "id", "migrationUnitId", "state", "sourceFingerprint", "fingerprintFormat", "sourceProvenanceJson", "startedAt"
) VALUES (?, ?, 'PENDING', ?, ?, ?, ?)
`).bind(
            attemptId,
            unitId,
            input.sourceFingerprint,
            input.fingerprintFormat,
            sourceProvenanceJson,
            startedAt,
          ),
        ]);
        requirePositiveChange(results, 0, "RESERVATION_FAILED");
        requirePositiveChange(results, 1, "RESERVATION_FAILED");
        const createdUnit = await readUnit(database, logicalKeySha256);
        const createdAttempt = await readAttempt(database, attemptId, unitId);
        if (createdUnit === null || createdAttempt === null) throw new MigrationLedgerError("RESERVATION_FAILED");
        return { kind: "RESERVED", unit: createdUnit, attempt: createdAttempt };
      } catch (error) {
        if (error instanceof MigrationLedgerError) throw error;
        // A concurrent reservation may have won either unique identity constraint.
        unit = await readUnit(database, logicalKeySha256);
        if (unit === null || !sameIdentity(unit, input.identity)) {
          throw new MigrationLedgerError("RESERVATION_FAILED");
        }
      }
    }

    const pending = await readPendingAttempt(database, unit.id);
    if (pending !== null) return { kind: "PENDING", unit, attempt: pending };

    if (unit.state === "APPLIED" && unit.lastFingerprint === input.sourceFingerprint) {
      const targetRefs = await readTargetRefs(database, unit.id);
      const verification = await verifyAllTargetRefs(database, unit, targetRefs, input.verifyAppliedTargetRefs);
      if (verification.status === "VERIFIED") return { kind: "IDEMPOTENT_APPLIED", unit, targetRefs };
      return { kind: "RECONCILIATION_REQUIRED", unit, targetRefs };
    }

    const attemptId = nextId();
    const startedAt = timestamp(now);
    try {
      const results = await database.batch([
        database.prepare(`
INSERT INTO "MigrationAttempt" (
  "id", "migrationUnitId", "state", "sourceFingerprint", "fingerprintFormat", "sourceProvenanceJson", "startedAt"
) VALUES (?, ?, 'PENDING', ?, ?, ?, ?)
`).bind(
          attemptId,
          unit.id,
          input.sourceFingerprint,
          input.fingerprintFormat,
          sourceProvenanceJson,
          startedAt,
        ),
      ]);
      requirePositiveChange(results, 0, "RESERVATION_FAILED");
      const createdAttempt = await readAttempt(database, attemptId, unit.id);
      const refreshedUnit = await readUnit(database, logicalKeySha256);
      if (createdAttempt === null || refreshedUnit === null) throw new MigrationLedgerError("RESERVATION_FAILED");
      return { kind: "RESERVED", unit: refreshedUnit, attempt: createdAttempt };
    } catch (error) {
      if (error instanceof MigrationLedgerError) throw error;
      const refreshedUnit = await readUnit(database, logicalKeySha256);
      if (refreshedUnit === null) throw new MigrationLedgerError("RESERVATION_FAILED");
      const activeAttempt = await readPendingAttempt(database, refreshedUnit.id);
      if (activeAttempt === null) throw new MigrationLedgerError("RESERVATION_FAILED");
      return { kind: "PENDING", unit: refreshedUnit, attempt: activeAttempt };
    }
  }

  async function finalizeMigrationWithoutTarget(input: FinalizeMigrationWithoutTargetInput): Promise<MigrationAttemptRecord> {
    if (!terminalStates.has(input.state) || input.state === "APPLIED") {
      throw new MigrationLedgerError("INVALID_RESERVATION");
    }
    const reasonCode = assertReasonCode(input.reasonCode);
    const outcomeEvidenceJson = serializeEvidence(input.outcomeEvidence, false);
    const failureEvidenceJson = serializeEvidence(input.failureEvidence, false);
    const completedAt = timestamp(now);
    try {
      const results = await database.batch([
        database.prepare(`
UPDATE "MigrationAttempt"
SET "state" = ?, "reasonCode" = ?, "outcomeEvidenceJson" = ?, "failureEvidenceJson" = ?, "completedAt" = ?
WHERE "id" = ? AND "migrationUnitId" = ? AND "state" = 'PENDING'
`).bind(
          input.state,
          reasonCode ?? null,
          outcomeEvidenceJson,
          failureEvidenceJson,
          completedAt,
          input.migrationAttemptId,
          input.migrationUnitId,
        ),
      ]);
      requirePositiveChange(results, 0, "FINALIZATION_FAILED");
    } catch (error) {
      if (error instanceof MigrationLedgerError) throw error;
      throw new MigrationLedgerError("FINALIZATION_FAILED");
    }
    const attempt = await readAttempt(database, input.migrationAttemptId, input.migrationUnitId);
    if (attempt === null) throw new MigrationLedgerError("FINALIZATION_FAILED");
    return attempt;
  }

  async function applyMigrationWithTargetsAtomically(input: ApplyMigrationWithTargetsInput): Promise<MigrationAttemptRecord> {
    if (input.targetMutations.length === 0 || input.targetRefs.length === 0) {
      throw new MigrationLedgerError("INVALID_RESERVATION");
    }
    const reasonCode = assertReasonCode(input.reasonCode);
    const outcomeEvidenceJson = serializeEvidence(input.outcomeEvidence, false);
    const normalizedRefs = input.targetRefs.map(normalizeTargetRef);
    const refKeys = new Set<string>();
    for (const ref of normalizedRefs) {
      const key = `${ref.targetType}\0${ref.targetKey}\0${ref.consequenceKind}`;
      if (refKeys.has(key)) throw new MigrationLedgerError("INVALID_TARGET_KEY");
      refKeys.add(key);
    }

    const completedAt = timestamp(now);
    let statements: MigrationLedgerPreparedStatement[];
    try {
      statements = [
        ...input.targetMutations,
        ...normalizedRefs.map((ref) => database.prepare(`
INSERT INTO "MigrationTargetRef" (
  "id", "migrationUnitId", "establishedByAttemptId", "targetType", "targetKeyFormat", "targetKey", "consequenceKind", "createdAt"
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).bind(
          nextId(),
          input.migrationUnitId,
          input.migrationAttemptId,
          ref.targetType,
          ref.targetKeyFormat,
          ref.targetKey,
          ref.consequenceKind,
          completedAt,
        )),
        database.prepare(`
UPDATE "MigrationAttempt"
SET "state" = 'APPLIED', "reasonCode" = ?, "outcomeEvidenceJson" = ?, "failureEvidenceJson" = NULL, "completedAt" = ?
WHERE "id" = ? AND "migrationUnitId" = ? AND "state" = 'PENDING'
`).bind(
          reasonCode ?? null,
          outcomeEvidenceJson,
          completedAt,
          input.migrationAttemptId,
          input.migrationUnitId,
        ),
      ];
    } catch (error) {
      if (error instanceof MigrationLedgerError) throw error;
      throw new MigrationLedgerError("ATOMIC_APPLY_FAILED");
    }

    try {
      const results = await database.batch(statements);
      requirePositiveChange(results, statements.length - 1, "ATOMIC_APPLY_FAILED");
    } catch (error) {
      if (error instanceof MigrationLedgerError) throw error;
      throw new MigrationLedgerError("ATOMIC_APPLY_FAILED");
    }
    const attempt = await readAttempt(database, input.migrationAttemptId, input.migrationUnitId);
    if (attempt === null || attempt.state !== "APPLIED") throw new MigrationLedgerError("ATOMIC_APPLY_FAILED");
    return attempt;
  }

  async function reconcileMigrationAppliedWithVerification(
    input: ReconcileMigrationAppliedWithVerificationInput,
  ): Promise<MigrationAppliedReconciliationResult> {
    const unit = await readUnitById(database, input.migrationUnitId);
    const attempt = await readAttempt(database, input.migrationAttemptId, input.migrationUnitId);
    if (unit === null || attempt === null || attempt.state !== "PENDING") {
      throw new MigrationLedgerError("INVALID_RESERVATION");
    }
    const targetRefs = await readTargetRefs(database, input.migrationUnitId);
    const verification = await verifyAllTargetRefs(database, unit, targetRefs, input.verifyTargetRefs);
    if (verification.status !== "VERIFIED") {
      return { kind: "NOT_VERIFIED", reasonCode: verification.reasonCode };
    }

    const outcomeEvidenceJson = serializeEvidence(verificationEvidence(verification), false);
    const completedAt = timestamp(now);
    try {
      const results = await database.batch([
        database.prepare(`
UPDATE "MigrationAttempt"
SET "state" = 'APPLIED', "reasonCode" = ?, "outcomeEvidenceJson" = ?, "failureEvidenceJson" = NULL, "completedAt" = ?
WHERE "id" = ? AND "migrationUnitId" = ? AND "state" = 'PENDING'
`).bind(
          "MATERIAL_TARGET_VERIFIED",
          outcomeEvidenceJson,
          completedAt,
          input.migrationAttemptId,
          input.migrationUnitId,
        ),
      ]);
      requirePositiveChange(results, 0, "FINALIZATION_FAILED");
    } catch (error) {
      if (error instanceof MigrationLedgerError) throw error;
      throw new MigrationLedgerError("FINALIZATION_FAILED");
    }
    const finalizedAttempt = await readAttempt(database, input.migrationAttemptId, input.migrationUnitId);
    if (finalizedAttempt === null || finalizedAttempt.state !== "APPLIED") throw new MigrationLedgerError("FINALIZATION_FAILED");
    return { kind: "APPLIED", attempt: finalizedAttempt };
  }

  return {
    reserveMigrationAttempt,
    finalizeMigrationWithoutTarget,
    reconcileMigrationAppliedWithVerification,
    applyMigrationWithTargetsAtomically,
    getMigrationUnit,
    getMigrationTargetRefs: (migrationUnitId) => readTargetRefs(database, migrationUnitId),
  };
}
