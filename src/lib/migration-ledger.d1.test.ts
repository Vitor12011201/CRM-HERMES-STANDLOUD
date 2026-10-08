import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  canonicalJsonTargetKey,
  canonicalUuidTargetKey,
  computeMigrationLogicalKey,
  computeMigrationSourceFingerprint,
  createMigrationLedgerWriter,
  type MigrationLedgerD1Database,
  type MigrationTargetRefVerifier,
} from "./migration-ledger";

const repositoryRoot = process.cwd();
const wranglerEntry = join(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const defaultDatabaseName = "standloud-crm-prod";
const localDatabaseId = "5e3373f0-79c0-452b-8f51-abfcb23b2931";
const timestamp = "2026-10-07T00:00:00.000Z";

type LocalD1PreparedStatement = {
  bind(...values: unknown[]): LocalD1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

type LocalD1Result = {
  meta?: { changes?: number };
  results?: Array<Record<string, unknown>>;
};

type LocalD1Database = {
  prepare(query: string): LocalD1PreparedStatement;
  batch(statements: readonly LocalD1PreparedStatement[]): Promise<LocalD1Result[]>;
};

type CommandFailure = Error & { stdout?: string | Buffer; stderr?: string | Buffer };

let temporaryRoot: string;
let cleanPersistPath: string;
let miniflare: Miniflare;
let database: LocalD1Database;
let writer: ReturnType<typeof createMigrationLedgerWriter>;

function runWrangler(args: string[], workingDirectory = repositoryRoot) {
  return execFileSync(process.execPath, [wranglerEntry, ...args], {
    cwd: workingDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
}

function d1Args(persistPath: string, databaseName = defaultDatabaseName, configPath?: string) {
  return [
    "d1",
    "execute",
    databaseName,
    ...(configPath ? ["--config", configPath] : []),
    "--local",
    "--persist-to",
    persistPath,
  ];
}

function errorText(error: unknown) {
  const commandFailure = error as CommandFailure;
  return [
    error instanceof Error ? error.message : String(error),
    commandFailure.stdout?.toString(),
    commandFailure.stderr?.toString(),
  ].filter(Boolean).join("\n");
}

async function executeSql(query: string, ...values: unknown[]) {
  return database.batch([database.prepare(query).bind(...values)]);
}

async function rows(query: string, ...values: unknown[]) {
  const result = await database.prepare(query).bind(...values).all();
  return result.results;
}

async function scalar(query: string, ...values: unknown[]) {
  const result = await rows(query, ...values);
  return Number(result[0]?.total);
}

async function expectSqlFailure(query: string, values: readonly unknown[] = [], expectedMarker?: string) {
  let thrown: unknown;
  try {
    await executeSql(query, ...values);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  if (expectedMarker) expect(errorText(thrown)).toContain(expectedMarker);
}

function identity(name: string) {
  return {
    sourceSystem: "STANDLOUD_LEGACY_D1",
    sourceType: "TEST_SOURCE",
    sourceId: name,
    targetResponsibility: "TEST_TARGET_RESPONSIBILITY",
    ruleVersion: "tr02b-test/v1",
  };
}

function fingerprint(character: string) {
  return character.repeat(64);
}

async function reserve(name: string, character = "a") {
  const result = await writer.reserveMigrationAttempt({
    identity: identity(name),
    sourceFingerprint: fingerprint(character),
    fingerprintFormat: "test-sha256/v1",
    sourceProvenance: { source: name, version: 1 },
  });
  expect(result.kind).toBe("RESERVED");
  if (result.kind !== "RESERVED") throw new Error("Expected a new reservation.");
  return result;
}

async function insertBusiness(id: string) {
  await executeSql('INSERT INTO "Business" ("id") VALUES (?)', id);
}

async function insertTargetRef(
  migrationUnitId: string,
  establishedByAttemptId: string,
  targetKey: string,
  consequenceKind = "CREATED",
) {
  const id = crypto.randomUUID();
  await executeSql(`
INSERT INTO "MigrationTargetRef" (
  "id", "migrationUnitId", "establishedByAttemptId", "targetType", "targetKeyFormat", "targetKey", "consequenceKind", "createdAt"
) VALUES (?, ?, ?, 'Business', 'uuid/v1', ?, ?, ?)
`, id, migrationUnitId, establishedByAttemptId, targetKey, consequenceKind, timestamp);
  return id;
}

const businessTargetVerifier: MigrationTargetRefVerifier = async ({ database: verifierDatabase, targetRefs }) => {
  const verifiedTargetRefIds: string[] = [];
  for (const targetRef of targetRefs) {
    if (targetRef.targetType !== "Business" || targetRef.targetKeyFormat !== "uuid/v1") {
      return {
        status: "NOT_VERIFIED",
        reasonCode: "BUSINESS_TARGET_REF_UNSUPPORTED",
        evidence: { verifier: "business-d1/v1", targetRefId: targetRef.id },
      };
    }
    const business = await verifierDatabase.prepare('SELECT "id" FROM "Business" WHERE "id" = ?')
      .bind(targetRef.targetKey)
      .first<{ id: string }>();
    if (business === null) {
      return {
        status: "NOT_VERIFIED",
        reasonCode: "BUSINESS_TARGET_MISSING",
        evidence: { verifier: "business-d1/v1", targetRefId: targetRef.id },
      };
    }
    verifiedTargetRefIds.push(targetRef.id);
  }
  return {
    status: "VERIFIED",
    verifiedTargetRefIds,
    evidence: { verifier: "business-d1/v1", verifiedBusinessCount: verifiedTargetRefIds.length },
  };
};

function createLegacyConfig(configDirectory: string) {
  const migrationsDirectory = join(configDirectory, "migrations");
  mkdirSync(migrationsDirectory, { recursive: true });
  writeFileSync(join(configDirectory, "wrangler.json"), JSON.stringify({
    name: "tr02b-legacy-upgrade",
    compatibility_date: "2026-09-20",
    d1_databases: [{
      binding: "DB",
      database_name: "tr02b-legacy-upgrade",
      database_id: "11111111-1111-4111-8111-111111111111",
      migrations_dir: "migrations",
    }],
  }));
  return { configPath: join(configDirectory, "wrangler.json"), migrationsDirectory };
}

describe("TR-02B real disposable D1 migration ledger", () => {
  beforeAll(async () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), "standloud-tr02b-"));
    cleanPersistPath = join(temporaryRoot, "clean-persist");
    runWrangler([
      "d1",
      "migrations",
      "apply",
      defaultDatabaseName,
      "--local",
      "--persist-to",
      cleanPersistPath,
    ]);
    miniflare = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: "",
      resourcePersistencePath: join(cleanPersistPath, "v3"),
      d1Databases: { DATABASE: localDatabaseId },
    }));
    database = await miniflare.getD1Database("DATABASE") as unknown as LocalD1Database;
    writer = createMigrationLedgerWriter(database as unknown as MigrationLedgerD1Database, {
      now: () => new Date(timestamp),
    });
  }, 120_000);

  afterAll(async () => {
    await miniflare?.dispose();
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("bootstraps 0001 through 0013 without ledger rows", async () => {
    expect(await scalar("SELECT COUNT(*) AS total FROM d1_migrations")).toBe(13);
    expect(await scalar("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name IN ('MigrationUnit', 'MigrationAttempt', 'MigrationTargetRef')")).toBe(3);
    expect(await scalar("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'index' AND name = 'MigrationAttempt_one_pending_per_unit'")).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'trigger' AND name IN ('MigrationUnit_identity_immutable', 'MigrationAttempt_transition_guard', 'MigrationTargetRef_insert_pending_attempt_only')")).toBe(3);
    expect(await scalar('SELECT COUNT(*) AS total FROM "MigrationUnit"')).toBe(0);
    expect(await scalar('SELECT COUNT(*) AS total FROM "Lead"')).toBe(0);
  }, 120_000);

  it("uses the frozen logical hash byte contract and rejects invalid identity", async () => {
    const base = identity("hash-source");
    const first = await computeMigrationLogicalKey(base);
    expect(first).toHaveLength(64);
    await expect(computeMigrationLogicalKey({ ...base })).resolves.toBe(first);
    for (const field of ["sourceSystem", "sourceType", "sourceId", "targetResponsibility", "ruleVersion"] as const) {
      await expect(computeMigrationLogicalKey({ ...base, [field]: `${base[field]}-changed` })).resolves.not.toBe(first);
    }
    await expect(computeMigrationLogicalKey({ ...base, sourceId: "" })).rejects.toMatchObject({ code: "INVALID_LOGICAL_IDENTITY" });
    await expect(computeMigrationLogicalKey({ ...base, sourceId: "bad\0source" })).rejects.toMatchObject({ code: "INVALID_LOGICAL_IDENTITY" });
    await expect(computeMigrationSourceFingerprint("canonical source material")).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(writer.reserveMigrationAttempt({
      identity: identity("oversized-evidence"),
      sourceFingerprint: fingerprint("a"),
      fingerprintFormat: "test-sha256/v1",
      sourceProvenance: "x".repeat(32_769),
    })).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
  });

  it("enforces immutable, non-destructive Unit and Attempt history", async () => {
    const reservation = await reserve("immutability");
    const { unit, attempt } = reservation;

    await expectSqlFailure('UPDATE "MigrationUnit" SET "sourceId" = ? WHERE "id" = ?', ["rewritten", unit.id], "MIGRATION_UNIT_IDENTITY_IMMUTABLE");
    await expectSqlFailure('DELETE FROM "MigrationUnit" WHERE "id" = ?', [unit.id], "MIGRATION_UNIT_DELETE_FORBIDDEN");
    await expectSqlFailure(`
INSERT INTO "MigrationAttempt" ("id", "migrationUnitId", "state", "sourceFingerprint", "fingerprintFormat", "sourceProvenanceJson", "startedAt", "completedAt")
VALUES (?, ?, 'APPLIED', ?, 'test-sha256/v1', '{}', ?, ?)
`, [crypto.randomUUID(), unit.id, fingerprint("b"), timestamp, timestamp], "MIGRATION_ATTEMPT_MUST_START_PENDING");
    await expectSqlFailure(`
INSERT INTO "MigrationAttempt" ("id", "migrationUnitId", "state", "sourceFingerprint", "fingerprintFormat", "sourceProvenanceJson", "startedAt", "completedAt")
VALUES (?, ?, 'PENDING', ?, 'test-sha256/v1', '{}', ?, ?)
`, [crypto.randomUUID(), unit.id, fingerprint("b"), timestamp, timestamp], "MIGRATION_ATTEMPT_MUST_START_PENDING");
    await expectSqlFailure(`
INSERT INTO "MigrationAttempt" ("id", "migrationUnitId", "state", "sourceFingerprint", "fingerprintFormat", "sourceProvenanceJson", "startedAt")
VALUES (?, ?, 'PENDING', ?, 'test-sha256/v1', '{}', ?)
`, [crypto.randomUUID(), unit.id, fingerprint("b"), timestamp]);
    await expectSqlFailure('UPDATE "MigrationAttempt" SET "sourceFingerprint" = ? WHERE "id" = ?', [fingerprint("c"), attempt.id], "MIGRATION_ATTEMPT_CREATION_FIELDS_IMMUTABLE");
    await expectSqlFailure('UPDATE "MigrationAttempt" SET "sourceProvenanceJson" = ? WHERE "id" = ?', ['{"rewritten":true}', attempt.id], "MIGRATION_ATTEMPT_CREATION_FIELDS_IMMUTABLE");

    await expect(writer.finalizeMigrationWithoutTarget({
      migrationUnitId: unit.id,
      migrationAttemptId: attempt.id,
      state: "SKIPPED",
      reasonCode: "PRESERVE_ONLY",
      outcomeEvidence: { preserved: true },
    })).resolves.toMatchObject({ state: "SKIPPED" });
    await expectSqlFailure('UPDATE "MigrationAttempt" SET "state" = ? WHERE "id" = ?', ["FAILED", attempt.id], "MIGRATION_ATTEMPT_TERMINAL_IMMUTABLE");
    await expectSqlFailure('DELETE FROM "MigrationAttempt" WHERE "id" = ?', [attempt.id], "MIGRATION_ATTEMPT_DELETE_FORBIDDEN");
  });

  it("enforces TargetRef ownership, immutability, target-key formats, and duplicate consequences", async () => {
    expect(canonicalUuidTargetKey("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(canonicalJsonTargetKey(["case-a", "candidate-a"])).toBe('["case-a","candidate-a"]');
    expect(() => canonicalUuidTargetKey("not-a-uuid")).toThrow("INVALID_TARGET_KEY");

    const first = await reserve("target-ref-first");
    const second = await reserve("target-ref-second");
    const businessId = "10000000-0000-4000-8000-000000000001";
    await insertBusiness(businessId);
    await expectSqlFailure(`
INSERT INTO "MigrationTargetRef" ("id", "migrationUnitId", "establishedByAttemptId", "targetType", "targetKeyFormat", "targetKey", "consequenceKind", "createdAt")
VALUES (?, ?, ?, 'Business', 'uuid/v1', ?, 'CREATED', ?)
`, [crypto.randomUUID(), first.unit.id, second.attempt.id, businessId, timestamp], "MIGRATION_TARGET_REF_REQUIRES_PENDING_ESTABLISHING_ATTEMPT");

    const establishedRefId = await insertTargetRef(first.unit.id, first.attempt.id, businessId);
    await expectSqlFailure('UPDATE "MigrationTargetRef" SET "targetKey" = ? WHERE "migrationUnitId" = ?', ["20000000-0000-4000-8000-000000000002", first.unit.id], "MIGRATION_TARGET_REF_IMMUTABLE");
    await expectSqlFailure('DELETE FROM "MigrationTargetRef" WHERE "migrationUnitId" = ?', [first.unit.id], "MIGRATION_TARGET_REF_DELETE_FORBIDDEN");
    await expectSqlFailure(`
INSERT INTO "MigrationTargetRef" ("id", "migrationUnitId", "establishedByAttemptId", "targetType", "targetKeyFormat", "targetKey", "consequenceKind", "createdAt")
VALUES (?, ?, ?, 'Business', 'uuid/v1', ?, 'CREATED', ?)
`, [crypto.randomUUID(), first.unit.id, first.attempt.id, businessId, timestamp]);
    await expectSqlFailure(`
INSERT INTO "MigrationTargetRef" ("id", "migrationUnitId", "establishedByAttemptId", "targetType", "targetKeyFormat", "targetKey", "consequenceKind", "createdAt")
VALUES (?, ?, ?, 'Business', 'uuid/v1', ?, 'CREATED', ?)
`, [crypto.randomUUID(), first.unit.id, first.attempt.id, businessId, timestamp]);

    await expectSqlFailure(`
UPDATE "MigrationAttempt" SET "state" = 'FAILED', "completedAt" = ?
WHERE "id" = ?
`, [timestamp, first.attempt.id], "MIGRATION_ATTEMPT_ESTABLISHED_REF_REQUIRES_APPLIED");
    await expect(writer.reconcileMigrationAppliedWithVerification({
      migrationUnitId: first.unit.id,
      migrationAttemptId: first.attempt.id,
      verifyTargetRefs: businessTargetVerifier,
    })).resolves.toMatchObject({ kind: "APPLIED", attempt: { state: "APPLIED" } });
    const firstOutcome = await rows('SELECT "reasonCode", "outcomeEvidenceJson" FROM "MigrationAttempt" WHERE "id" = ?', first.attempt.id);
    expect(firstOutcome).toEqual([{
      reasonCode: "MATERIAL_TARGET_VERIFIED",
      outcomeEvidenceJson: JSON.stringify({
        targetEvidence: { verifiedBusinessCount: 1, verifier: "business-d1/v1" },
        verificationKind: "migration-target-material-verification/v1",
        verifiedTargetRefIds: [establishedRefId],
      }),
    }]);
    const laterReconciliation = await writer.reserveMigrationAttempt({
      identity: identity("target-ref-first"),
      sourceFingerprint: fingerprint("b"),
      fingerprintFormat: "test-sha256/v1",
      sourceProvenance: { source: "target-ref-first", version: 2 },
    });
    expect(laterReconciliation.kind).toBe("RESERVED");
    if (laterReconciliation.kind !== "RESERVED") throw new Error("Expected a reconciliation attempt.");
    await expect(writer.reconcileMigrationAppliedWithVerification({
      migrationUnitId: laterReconciliation.unit.id,
      migrationAttemptId: laterReconciliation.attempt.id,
      verifyTargetRefs: businessTargetVerifier,
    })).resolves.toMatchObject({ kind: "APPLIED", attempt: { state: "APPLIED" } });
    expect(await writer.getMigrationTargetRefs(first.unit.id)).toHaveLength(1);
    await expectSqlFailure(`
INSERT INTO "MigrationTargetRef" ("id", "migrationUnitId", "establishedByAttemptId", "targetType", "targetKeyFormat", "targetKey", "consequenceKind", "createdAt")
VALUES (?, ?, ?, 'Business', 'uuid/v1', ?, 'CREATED', ?)
`, [crypto.randomUUID(), first.unit.id, first.attempt.id, "20000000-0000-4000-8000-000000000002", timestamp], "MIGRATION_TARGET_REF_REQUIRES_PENDING_ESTABLISHING_ATTEMPT");
  });

  it("enforces outcome/ref coherence and synchronizes Unit projections", async () => {
    const noRef = await reserve("applied-needs-ref");
    await expectSqlFailure(`
UPDATE "MigrationAttempt" SET "state" = 'APPLIED', "completedAt" = ?
WHERE "id" = ?
`, [timestamp, noRef.attempt.id], "MIGRATION_ATTEMPT_APPLIED_REQUIRES_TARGET_REF");
    await expect(writer.finalizeMigrationWithoutTarget({
      migrationUnitId: noRef.unit.id,
      migrationAttemptId: noRef.attempt.id,
      state: "AMBIGUOUS",
      outcomeEvidence: { reason: "no exact target" },
    })).resolves.toMatchObject({ state: "AMBIGUOUS" });
    const noRefUnit = await writer.getMigrationUnit(identity("applied-needs-ref"));
    expect(noRefUnit).toMatchObject({ state: "AMBIGUOUS", lastFingerprint: fingerprint("a"), fingerprintFormat: "test-sha256/v1" });

    for (const [index, state] of ["SKIPPED", "AMBIGUOUS", "FAILED", "RECONCILE_REQUIRED"].entries()) {
      const reserved = await reserve(`ref-needs-applied-${state}`);
      const target = `20000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
      await insertBusiness(target);
      await insertTargetRef(reserved.unit.id, reserved.attempt.id, target);
      await expectSqlFailure(`
UPDATE "MigrationAttempt" SET "state" = ?, "completedAt" = ?
WHERE "id" = ?
`, [state, timestamp, reserved.attempt.id], "MIGRATION_ATTEMPT_ESTABLISHED_REF_REQUIRES_APPLIED");
      await expect(writer.reconcileMigrationAppliedWithVerification({
        migrationUnitId: reserved.unit.id,
        migrationAttemptId: reserved.attempt.id,
        verifyTargetRefs: businessTargetVerifier,
      })).resolves.toMatchObject({ kind: "APPLIED", attempt: { state: "APPLIED" } });
    }
  }, 15_000);

  it("commits target mutation, ref, attempt, and Unit projection atomically", async () => {
    const success = await reserve("atomic-success");
    const businessId = "30000000-0000-4000-8000-000000000003";
    await expect(writer.applyMigrationWithTargetsAtomically({
      migrationUnitId: success.unit.id,
      migrationAttemptId: success.attempt.id,
      targetMutations: [database.prepare('INSERT INTO "Business" ("id") VALUES (?)').bind(businessId)],
      targetRefs: [{
        targetType: "Business",
        targetKey: { format: "uuid/v1", uuid: businessId },
        consequenceKind: "CREATED",
      }],
      outcomeEvidence: { commit: "atomic" },
    })).resolves.toMatchObject({ state: "APPLIED" });
    expect(await scalar('SELECT COUNT(*) AS total FROM "Business" WHERE "id" = ?', businessId)).toBe(1);
    expect((await writer.getMigrationTargetRefs(success.unit.id))).toHaveLength(1);
    expect(await writer.getMigrationUnit(identity("atomic-success"))).toMatchObject({ state: "APPLIED", lastFingerprint: fingerprint("a") });

    const failed = await reserve("atomic-failure");
    const failedBusinessId = "40000000-0000-4000-8000-000000000004";
    await expect(writer.applyMigrationWithTargetsAtomically({
      migrationUnitId: failed.unit.id,
      migrationAttemptId: failed.attempt.id,
      targetMutations: [
        database.prepare('INSERT INTO "Business" ("id") VALUES (?)').bind(failedBusinessId),
        database.prepare('INSERT INTO "Business" ("id") VALUES (?)').bind(failedBusinessId),
      ],
      targetRefs: [{
        targetType: "Business",
        targetKey: { format: "uuid/v1", uuid: failedBusinessId },
        consequenceKind: "CREATED",
      }],
    })).rejects.toMatchObject({ code: "ATOMIC_APPLY_FAILED" });
    expect(await scalar('SELECT COUNT(*) AS total FROM "Business" WHERE "id" = ?', failedBusinessId)).toBe(0);
    expect(await writer.getMigrationTargetRefs(failed.unit.id)).toHaveLength(0);
    expect(await rows('SELECT "state" FROM "MigrationAttempt" WHERE "id" = ?', failed.attempt.id)).toEqual([{ state: "PENDING" }]);
    expect(await writer.getMigrationUnit(identity("atomic-failure"))).toMatchObject({ state: "PENDING" });
    await expect(writer.finalizeMigrationWithoutTarget({
      migrationUnitId: failed.unit.id,
      migrationAttemptId: failed.attempt.id,
      state: "FAILED",
      reasonCode: "BATCH_ROLLED_BACK",
      failureEvidence: { sqlite: "constraint" },
    })).resolves.toMatchObject({ state: "FAILED" });
  });

  it("reruns APPLIED units idempotently and preserves prior history on a fingerprint change", async () => {
    const initial = await reserve("rerun-and-change", "b");
    const businessId = "50000000-0000-4000-8000-000000000005";
    await writer.applyMigrationWithTargetsAtomically({
      migrationUnitId: initial.unit.id,
      migrationAttemptId: initial.attempt.id,
      targetMutations: [database.prepare('INSERT INTO "Business" ("id") VALUES (?)').bind(businessId)],
      targetRefs: [{
        targetType: "Business",
        targetKey: { format: "uuid/v1", uuid: businessId },
        consequenceKind: "CREATED",
      }],
    });
    const idempotent = await writer.reserveMigrationAttempt({
      identity: identity("rerun-and-change"),
      sourceFingerprint: fingerprint("b"),
      fingerprintFormat: "test-sha256/v1",
      sourceProvenance: { source: "rerun-and-change", version: 1 },
      verifyAppliedTargetRefs: businessTargetVerifier,
    });
    expect(idempotent.kind).toBe("IDEMPOTENT_APPLIED");
    expect(await scalar('SELECT COUNT(*) AS total FROM "Business" WHERE "id" = ?', businessId)).toBe(1);
    expect(await writer.getMigrationTargetRefs(initial.unit.id)).toHaveLength(1);

    const changed = await writer.reserveMigrationAttempt({
      identity: identity("rerun-and-change"),
      sourceFingerprint: fingerprint("c"),
      fingerprintFormat: "test-sha256/v1",
      sourceProvenance: { source: "rerun-and-change", version: 2 },
    });
    expect(changed.kind).toBe("RESERVED");
    if (changed.kind !== "RESERVED") throw new Error("Expected changed fingerprint reservation.");
    await expect(writer.finalizeMigrationWithoutTarget({
      migrationUnitId: changed.unit.id,
      migrationAttemptId: changed.attempt.id,
      state: "RECONCILE_REQUIRED",
      reasonCode: "FINGERPRINT_CHANGED",
      outcomeEvidence: { priorAttempt: initial.attempt.id },
    })).resolves.toMatchObject({ state: "RECONCILE_REQUIRED" });
    expect(await scalar('SELECT COUNT(*) AS total FROM "MigrationAttempt" WHERE "migrationUnitId" = ? AND "state" = ?', initial.unit.id, "APPLIED")).toBe(1);
    expect(await writer.getMigrationTargetRefs(initial.unit.id)).toHaveLength(1);
  });

  it("requires typed, exact material verification before returning IDEMPOTENT_APPLIED", async () => {
    const initial = await reserve("verification-coverage", "d");
    const businessA = "60000000-0000-4000-8000-000000000006";
    const businessB = "70000000-0000-4000-8000-000000000007";
    await writer.applyMigrationWithTargetsAtomically({
      migrationUnitId: initial.unit.id,
      migrationAttemptId: initial.attempt.id,
      targetMutations: [
        database.prepare('INSERT INTO "Business" ("id") VALUES (?)').bind(businessA),
        database.prepare('INSERT INTO "Business" ("id") VALUES (?)').bind(businessB),
      ],
      targetRefs: [
        { targetType: "Business", targetKey: { format: "uuid/v1", uuid: businessA }, consequenceKind: "CREATED" },
        { targetType: "Business", targetKey: { format: "uuid/v1", uuid: businessB }, consequenceKind: "CREATED" },
      ],
    });
    const unchangedInput = {
      identity: identity("verification-coverage"),
      sourceFingerprint: fingerprint("d"),
      fingerprintFormat: "test-sha256/v1",
      sourceProvenance: { source: "verification-coverage", version: 1 },
    };

    await expect(writer.reserveMigrationAttempt(unchangedInput)).resolves.toMatchObject({ kind: "RECONCILIATION_REQUIRED" });
    await expect(writer.reserveMigrationAttempt({
      ...unchangedInput,
      verifyAppliedTargetRefs: async () => ({ status: "NOT_VERIFIED", reasonCode: "BUSINESS_READ_UNAVAILABLE" }),
    })).resolves.toMatchObject({ kind: "RECONCILIATION_REQUIRED" });

    const refs = await writer.getMigrationTargetRefs(initial.unit.id);
    const invalidVerifiedResults = [
      [] as string[],
      [refs[0]!.id],
      [...refs.map((ref) => ref.id), crypto.randomUUID()],
      [refs[0]!.id, refs[0]!.id],
    ];
    for (const verifiedTargetRefIds of invalidVerifiedResults) {
      await expect(writer.reserveMigrationAttempt({
        ...unchangedInput,
        verifyAppliedTargetRefs: async () => ({ status: "VERIFIED", verifiedTargetRefIds }),
      })).resolves.toMatchObject({ kind: "RECONCILIATION_REQUIRED" });
    }
    await expect(writer.reserveMigrationAttempt({
      ...unchangedInput,
      verifyAppliedTargetRefs: businessTargetVerifier,
    })).resolves.toMatchObject({ kind: "IDEMPOTENT_APPLIED" });
  });

  it("does not reconcile APPLIED when a real Business target is missing", async () => {
    const initial = await reserve("missing-business", "e");
    const businessId = "80000000-0000-4000-8000-000000000008";
    await writer.applyMigrationWithTargetsAtomically({
      migrationUnitId: initial.unit.id,
      migrationAttemptId: initial.attempt.id,
      targetMutations: [database.prepare('INSERT INTO "Business" ("id") VALUES (?)').bind(businessId)],
      targetRefs: [{
        targetType: "Business",
        targetKey: { format: "uuid/v1", uuid: businessId },
        consequenceKind: "CREATED",
      }],
    });
    await executeSql('DELETE FROM "Business" WHERE "id" = ?', businessId);

    await expect(writer.reserveMigrationAttempt({
      identity: identity("missing-business"),
      sourceFingerprint: fingerprint("e"),
      fingerprintFormat: "test-sha256/v1",
      sourceProvenance: { source: "missing-business", version: 1 },
      verifyAppliedTargetRefs: businessTargetVerifier,
    })).resolves.toMatchObject({ kind: "RECONCILIATION_REQUIRED" });

    const pending = await writer.reserveMigrationAttempt({
      identity: identity("missing-business"),
      sourceFingerprint: fingerprint("f"),
      fingerprintFormat: "test-sha256/v1",
      sourceProvenance: { source: "missing-business", version: 2 },
    });
    expect(pending.kind).toBe("RESERVED");
    if (pending.kind !== "RESERVED") throw new Error("Expected a pending reconciliation attempt.");
    expect("finalizeMigrationAppliedReconciliation" in writer).toBe(false);
    await expect(writer.reconcileMigrationAppliedWithVerification({
      migrationUnitId: pending.unit.id,
      migrationAttemptId: pending.attempt.id,
      verifyTargetRefs: undefined as never,
    })).resolves.toEqual({ kind: "NOT_VERIFIED", reasonCode: "TARGET_VERIFIER_REQUIRED" });
    await expect(writer.reconcileMigrationAppliedWithVerification({
      migrationUnitId: pending.unit.id,
      migrationAttemptId: pending.attempt.id,
      verifyTargetRefs: businessTargetVerifier,
    })).resolves.toEqual({ kind: "NOT_VERIFIED", reasonCode: "BUSINESS_TARGET_MISSING" });
    expect(await rows('SELECT "state" FROM "MigrationAttempt" WHERE "id" = ?', pending.attempt.id)).toEqual([{ state: "PENDING" }]);
    expect(await writer.getMigrationTargetRefs(pending.unit.id)).toHaveLength(1);
  });

  it("upgrades a disposable legacy 0001..0002 database through 0011 and reapplies cleanly", () => {
    const upgradeRoot = join(temporaryRoot, "legacy-upgrade");
    const { configPath, migrationsDirectory } = createLegacyConfig(upgradeRoot);
    const migrationFiles = [
      "0001_init.sql",
      "0002_agent_audit_log.sql",
      "0003_lead_research.sql",
      "0004_scout_candidate_review.sql",
      "0005_agent_prompt_config.sql",
      "0006_lead_research_run.sql",
      "0007_core_target_identities.sql",
      "0008_migration_ledger.sql",
      "0009_authority_kernel.sql",
      "0010_authority_hardening.sql",
      "0011_execution_run_kernel.sql",
    ];
    for (const migration of migrationFiles.slice(0, 2)) {
      cpSync(join(repositoryRoot, "prisma", "migrations", migration), join(migrationsDirectory, migration));
    }
    const legacyPersistPath = join(upgradeRoot, "persist");
    runWrangler(["d1", "migrations", "apply", "tr02b-legacy-upgrade", "--config", configPath, "--local", "--persist-to", legacyPersistPath]);
    for (const migration of migrationFiles.slice(2)) {
      cpSync(join(repositoryRoot, "prisma", "migrations", migration), join(migrationsDirectory, migration));
    }
    runWrangler(["d1", "migrations", "apply", "tr02b-legacy-upgrade", "--config", configPath, "--local", "--persist-to", legacyPersistPath]);
    const output = runWrangler([...d1Args(legacyPersistPath, "tr02b-legacy-upgrade", configPath), "--command", "SELECT COUNT(*) AS total FROM d1_migrations", "--json"]);
    const applied = (JSON.parse(output) as Array<{ results?: Array<Record<string, unknown>> }>)[0]?.results ?? [];
    expect(Number(applied[0]?.total)).toBe(11);
    const reapply = runWrangler(["d1", "migrations", "apply", "tr02b-legacy-upgrade", "--config", configPath, "--local", "--persist-to", legacyPersistPath]);
    expect(reapply).toMatch(/No migrations to apply/i);
  }, 120_000);
});
