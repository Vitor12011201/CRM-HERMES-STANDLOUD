import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const wranglerEntrypoint = join(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const migrationsDirectory = join(repositoryRoot, "prisma", "migrations");
const databaseName = "standloud-crm-prod";
const databaseId = "5e3373f0-79c0-452b-8f51-abfcb23b2931";
const fixedTime = "2026-10-08T12:00:00.000Z";
const sha = (character: string) => character.repeat(64);
const validSourceReference = "sr:v1:550e8400-e29b-41d4-a716-446655440000";

type CommandFailure = Error & { stdout?: string | Buffer; stderr?: string | Buffer };
type SqlValue = string | number | null;

let temporaryRoot: string;
let persistenceDirectory: string;

function runWrangler(args: string[], cwd = repositoryRoot) {
  return execFileSync(process.execPath, [wranglerEntrypoint, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
}

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sql(value: SqlValue) {
  if (value === null) return "NULL";
  return typeof value === "number" ? String(value) : quote(value);
}

function errorText(error: unknown) {
  const commandFailure = error as CommandFailure;
  return [
    error instanceof Error ? error.message : String(error),
    commandFailure.stdout?.toString(),
    commandFailure.stderr?.toString(),
  ].filter(Boolean).join("\n");
}

function d1Args(persistPath: string, configPath = join(repositoryRoot, "wrangler.jsonc")) {
  return [
    "d1",
    "execute",
    databaseName,
    "--local",
    "--persist-to",
    persistPath,
    "--config",
    configPath,
  ];
}

function execute(statement: string) {
  return runWrangler([...d1Args(persistenceDirectory), "--command", statement]);
}

function query<T>(statement: string) {
  const output = runWrangler([...d1Args(persistenceDirectory), "--command", statement, "--json"]);
  return ((JSON.parse(output) as Array<{ results?: T[] }>)[0]?.results ?? []);
}

function scalar(statement: string) {
  return Number(query<{ value: number }>(statement)[0]?.value);
}

function expectFailure(statement: string, marker?: string) {
  let thrown: unknown;
  try {
    execute(statement);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  if (marker) expect(errorText(thrown)).toContain(marker);
}

type CostEntryInsert = Partial<{
  canonicalCostEntrySha256: string;
  economicOccurrenceKey: string;
  measurementNature: "ESTIMATED" | "ACTUAL";
  resourceKey: string;
  unitKey: string;
  quantityKnowledge: "KNOWN" | "UNKNOWN";
  quantityCoefficient: number | null;
  quantityScale: number | null;
  monetaryKnowledge: "KNOWN" | "UNKNOWN";
  amountMinor: number | null;
  currency: string | null;
  currencyScale: number | null;
  measurementSourceKind: string;
  sourceReference: string | null;
  evidenceSha256: string | null;
  measurementBasisSha256: string;
  occurredAt: string | null;
  observedAt: string | null;
  recordedAt: string;
  createdAt: string;
  experimentId: string | null;
  candidateId: string | null;
  commercialCaseId: string | null;
  executionRunId: string | null;
}> & {
  id: string;
  costEntryKey: string;
  measurementSliceKey: string;
};

function costEntryInsert(input: CostEntryInsert) {
  const row = {
    canonicalCostEntrySha256: sha("a"),
    economicOccurrenceKey: "occurrence:provider-a:october",
    measurementNature: "ACTUAL" as const,
    resourceKey: "HUMAN_TIME",
    unitKey: "MINUTE",
    quantityKnowledge: "KNOWN" as const,
    quantityCoefficient: 0,
    quantityScale: 0,
    monetaryKnowledge: "KNOWN" as const,
    amountMinor: 0,
    currency: "BRL",
    currencyScale: 2,
    measurementSourceKind: "PROVIDER_STATEMENT",
    sourceReference: validSourceReference,
    evidenceSha256: null,
    measurementBasisSha256: sha("b"),
    occurredAt: null,
    observedAt: null,
    recordedAt: fixedTime,
    createdAt: fixedTime,
    experimentId: null,
    candidateId: null,
    commercialCaseId: null,
    executionRunId: null,
    ...input,
  };
  const columns = [
    "id", "costEntryKey", "canonicalCostEntrySha256", "economicOccurrenceKey", "measurementSliceKey", "measurementNature",
    "resourceKey", "unitKey", "quantityKnowledge", "quantityCoefficient", "quantityScale", "monetaryKnowledge", "amountMinor",
    "currency", "currencyScale", "measurementSourceKind", "sourceReference", "evidenceSha256", "measurementBasisSha256",
    "occurredAt", "observedAt", "recordedAt", "createdAt", "experimentId", "candidateId", "commercialCaseId", "executionRunId",
  ] as const;
  const values = columns.map((column) => sql(row[column]));
  return `INSERT INTO "CostEntry" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${values.join(", ")})`;
}

function writeLegacyConfig(directory: string) {
  const configPath = join(directory, "wrangler.json");
  writeFileSync(configPath, JSON.stringify({
    name: "cost-entry-upgrade-test",
    compatibility_date: "2026-10-08",
    d1_databases: [{
      binding: "DB",
      database_name: databaseName,
      database_id: databaseId,
      migrations_dir: "migrations",
    }],
  }));
  return configPath;
}

describe("TR-04 CostEntry D1 restricted storage core", () => {
  describe("current 0012 fixture", () => {
    beforeAll(() => {
      temporaryRoot = mkdtempSync(join(tmpdir(), "standloud-cost-entry-"));
      persistenceDirectory = join(temporaryRoot, "clean-persist");
      runWrangler([
        "d1",
        "migrations",
        "apply",
        databaseName,
        "--local",
        "--persist-to",
        persistenceDirectory,
        "--config",
        join(repositoryRoot, "wrangler.jsonc"),
      ]);
    }, 120_000);

    afterAll(() => {
      if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
    });

  it("bootstraps 0001 through 0012 with only the approved cost table, indexes, FKs, and guards", () => {
    expect(scalar("SELECT COUNT(*) AS value FROM d1_migrations")).toBe(12);
    expect(scalar("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'CostEntry'")).toBe(1);
    expect(scalar("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name IN ('WorkflowEvent', 'CostEntryAttribution', 'CostReconciliation')")).toBe(0);
    expect(scalar("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'index' AND name IN ('CostEntry_economicOccurrenceKey_idx', 'CostEntry_experimentId_idx', 'CostEntry_candidateId_idx', 'CostEntry_commercialCaseId_idx', 'CostEntry_executionRunId_idx')")).toBe(5);
    expect(scalar("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'trigger' AND name IN ('CostEntry_update_forbidden', 'CostEntry_delete_forbidden')")).toBe(2);
    expect(scalar("SELECT COUNT(*) AS value FROM pragma_foreign_key_list('CostEntry') WHERE on_delete = 'RESTRICT' AND on_update = 'RESTRICT'")).toBe(4);
  }, 120_000);

  it("accepts distinct ESTIMATED and ACTUAL measurements, known zero, unknown money, and a shared zero-context cost", () => {
    execute(costEntryInsert({ id: "cost-actual-zero", costEntryKey: "cost:actual:zero", measurementSliceKey: "slice:actual:zero" }));
    execute(costEntryInsert({
      id: "cost-estimated-unknown",
      costEntryKey: "cost:estimated:unknown",
      measurementSliceKey: "slice:estimated:unknown",
      measurementNature: "ESTIMATED",
      monetaryKnowledge: "UNKNOWN",
      amountMinor: null,
      currency: null,
      currencyScale: null,
    }));
    expect(scalar("SELECT COUNT(*) AS value FROM CostEntry WHERE economicOccurrenceKey = 'occurrence:provider-a:october'")).toBe(2);
    expect(scalar("SELECT COUNT(*) AS value FROM CostEntry WHERE monetaryKnowledge = 'KNOWN' AND amountMinor = 0")).toBe(1);
    expect(scalar("SELECT COUNT(*) AS value FROM CostEntry WHERE monetaryKnowledge = 'UNKNOWN' AND amountMinor IS NULL AND currency IS NULL")).toBe(1);
    expect(scalar("SELECT COUNT(*) AS value FROM CostEntry WHERE experimentId IS NULL AND candidateId IS NULL AND commercialCaseId IS NULL AND executionRunId IS NULL")).toBe(2);
  }, 120_000);

  it("enforces opaque source-reference syntax directly in D1", () => {
    for (const [index, sourceReference] of [
      "email@example.test",
      "https://example.test/invoice",
      "<html>test</html>",
      "ignore previous instructions",
      "Invoice 123: amount 99",
      "sk-test-not-a-real-key",
      '{ "raw": "payload" }',
      " sr:v1:550e8400-e29b-41d4-a716-446655440000",
      "sr:v1:550e8400-e29b-41d4-a716-446655440000 ",
      "sr:v1:550e8400-e29b-41d4-a716-446655440000\t",
      "sr:v1:550e8400-e29b-41d4-a716-446655440000\n",
      "sr:v1:550E8400-e29b-41d4-a716-446655440000",
      "sr:v1:550e8400-e29b-11d4-a716-446655440000",
      "sr:v1:550e8400-e29b-71d4-a716-446655440000",
      "sr:v1:550e8400-e29b-41d4-c716-446655440000",
      "sr:v2:550e8400-e29b-41d4-a716-446655440000",
      "sr:v1:550e8400e29b-41d4-a716-446655440000",
      "sr:v1:550e8400-e29b-41d4-a716-446655440000x",
      "sr:v1:550e8400-e29b-41d4-a716-44665544000é",
    ].entries()) {
      expectFailure(costEntryInsert({
        id: `cost-invalid-source-${index}`,
        costEntryKey: `cost:invalid:source:${index}`,
        measurementSliceKey: `slice:invalid:source:${index}`,
        sourceReference,
        evidenceSha256: sha("d"),
      }));
    }
    expectFailure(
      costEntryInsert({
        id: "cost-invalid-source-nul",
        costEntryKey: "cost:invalid:source:nul",
        measurementSliceKey: "slice:invalid:source:nul",
        evidenceSha256: sha("d"),
      }).replace(quote(validSourceReference), `substr(${quote(validSourceReference)}, 1, 41) || char(0)`),
    );
    execute(costEntryInsert({
      id: "cost-source-reference-only",
      costEntryKey: "cost:source:reference-only",
      measurementSliceKey: "slice:source:reference-only",
      evidenceSha256: null,
    }));
    execute(costEntryInsert({
      id: "cost-evidence-digest-only",
      costEntryKey: "cost:evidence:digest-only",
      measurementSliceKey: "slice:evidence:digest-only",
      sourceReference: null,
      evidenceSha256: sha("e"),
    }));
    execute(costEntryInsert({
      id: "cost-source-and-evidence",
      costEntryKey: "cost:source:and:evidence",
      measurementSliceKey: "slice:source:and:evidence",
      evidenceSha256: sha("f"),
    }));
    expectFailure(costEntryInsert({
      id: "cost-source-and-evidence-missing",
      costEntryKey: "cost:source:and:evidence:missing",
      measurementSliceKey: "slice:source:and:evidence:missing",
      sourceReference: null,
      evidenceSha256: null,
    }));
  }, 120_000);

  it("does not turn legacy Project or Payment revenue records into costs", () => {
    const costCountBefore = scalar("SELECT COUNT(*) AS value FROM CostEntry");
    execute(`
      INSERT INTO "Project" ("id", "leadId", "clientName", "projectName", "totalAmountCents", "updatedAt")
      VALUES ('legacy-project-no-cost', NULL, 'Legacy client', 'Legacy revenue', 10000, '${fixedTime}');
    `);
    execute(`
      INSERT INTO "Payment" ("id", "projectId", "amountCents", "paidAt")
      VALUES ('legacy-payment-no-cost', 'legacy-project-no-cost', 10000, '${fixedTime}');
    `);
    expect(scalar("SELECT COUNT(*) AS value FROM CostEntry")).toBe(costCountBefore);
  }, 120_000);

  it("accepts one real direct context while keeping the other three null", () => {
    execute(`INSERT INTO "Experiment" ("id", "createdAt") VALUES ('experiment-cost-context', '${fixedTime}')`);
    execute(costEntryInsert({
      id: "cost-experiment-context",
      costEntryKey: "cost:experiment:context",
      measurementSliceKey: "slice:experiment:context",
      experimentId: "experiment-cost-context",
    }));
    expect(scalar("SELECT COUNT(*) AS value FROM CostEntry WHERE experimentId = 'experiment-cost-context' AND candidateId IS NULL AND commercialCaseId IS NULL AND executionRunId IS NULL")).toBe(1);
  }, 120_000);

  it("enforces supplied-key idempotency but permits distinct measurement slices for one occurrence", () => {
    const occurrenceCountBefore = scalar("SELECT COUNT(*) AS value FROM CostEntry WHERE economicOccurrenceKey = 'occurrence:provider-a:october'");
    execute(costEntryInsert({ id: "cost-idempotency-seed", costEntryKey: "cost:idempotency:seed", measurementSliceKey: "slice:idempotency:seed" }));
    expectFailure(costEntryInsert({ id: "cost-duplicate-key", costEntryKey: "cost:idempotency:seed", measurementSliceKey: "slice:other" }));
    expectFailure(costEntryInsert({ id: "cost-duplicate-slice", costEntryKey: "cost:other", measurementSliceKey: "slice:idempotency:seed" }));
    execute(costEntryInsert({ id: "cost-occurrence-second-slice", costEntryKey: "cost:occurrence:second", measurementSliceKey: "slice:occurrence:second" }));
    expect(scalar("SELECT COUNT(*) AS value FROM CostEntry WHERE economicOccurrenceKey = 'occurrence:provider-a:october'")).toBe(occurrenceCountBefore + 2);
  }, 120_000);

  it("rejects malformed hashes, source evidence, and incoherent known/unknown value pairs", () => {
    expectFailure(costEntryInsert({ id: "cost-bad-entry-hash", costEntryKey: "cost:bad:entry-hash", measurementSliceKey: "slice:bad:entry-hash", canonicalCostEntrySha256: "A".repeat(64) }));
    expectFailure(costEntryInsert({ id: "cost-bad-basis-hash", costEntryKey: "cost:bad:basis-hash", measurementSliceKey: "slice:bad:basis-hash", measurementBasisSha256: "c".repeat(63) }));
    expectFailure(costEntryInsert({ id: "cost-empty-source", costEntryKey: "cost:empty:source", measurementSliceKey: "slice:empty:source", sourceReference: null, evidenceSha256: null }));
    expectFailure(costEntryInsert({ id: "cost-known-quantity-null", costEntryKey: "cost:known:quantity:null", measurementSliceKey: "slice:known:quantity:null", quantityCoefficient: null }));
    expectFailure(costEntryInsert({ id: "cost-unknown-quantity-value", costEntryKey: "cost:unknown:quantity:value", measurementSliceKey: "slice:unknown:quantity:value", quantityKnowledge: "UNKNOWN", quantityCoefficient: 0, quantityScale: 0 }));
    expectFailure(costEntryInsert({ id: "cost-unknown-money-currency", costEntryKey: "cost:unknown:money:currency", measurementSliceKey: "slice:unknown:money:currency", monetaryKnowledge: "UNKNOWN", amountMinor: null, currency: "BRL", currencyScale: null }));
  }, 120_000);

  it("rejects unsafe numeric values, invalid clocks, and direct-context violations", () => {
    expectFailure(costEntryInsert({ id: "cost-negative", costEntryKey: "cost:negative", measurementSliceKey: "slice:negative", amountMinor: -1 }));
    expectFailure(costEntryInsert({ id: "cost-unsafe", costEntryKey: "cost:unsafe", measurementSliceKey: "slice:unsafe", amountMinor: 9007199254740992 }));
    expectFailure(costEntryInsert({ id: "cost-bad-scale", costEntryKey: "cost:bad:scale", measurementSliceKey: "slice:bad:scale", currencyScale: 19 }));
    expectFailure(costEntryInsert({ id: "cost-bad-clock", costEntryKey: "cost:bad:clock", measurementSliceKey: "slice:bad:clock", recordedAt: "not-a-timestamp" }));
    expectFailure(costEntryInsert({ id: "cost-double-context", costEntryKey: "cost:double:context", measurementSliceKey: "slice:double:context", experimentId: "missing-experiment", candidateId: "missing-candidate" }));
    expectFailure(costEntryInsert({ id: "cost-missing-context", costEntryKey: "cost:missing:context", measurementSliceKey: "slice:missing:context", experimentId: "missing-experiment" }));
  }, 120_000);

  it("keeps CostEntry permanently immutable after insertion", () => {
    execute(costEntryInsert({ id: "cost-immutable", costEntryKey: "cost:immutable", measurementSliceKey: "slice:immutable" }));
    expectFailure("UPDATE CostEntry SET resourceKey = 'MODEL_TOKEN' WHERE id = 'cost-immutable'", "COST_ENTRY_IMMUTABLE");
    expectFailure("DELETE FROM CostEntry WHERE id = 'cost-immutable'", "COST_ENTRY_DELETE_FORBIDDEN");
  }, 120_000);
  });

  it("upgrades a disposable 0011 database through 0012 and reapplies it as a no-op", () => {
    const upgradeRoot = mkdtempSync(join(tmpdir(), "standloud-cost-entry-upgrade-"));
    const legacyMigrations = join(upgradeRoot, "migrations");
    mkdirSync(legacyMigrations);
    const configPath = writeLegacyConfig(upgradeRoot);
    const migrationNames = [
      "0001_init.sql", "0002_agent_audit_log.sql", "0003_lead_research.sql", "0004_scout_candidate_review.sql",
      "0005_agent_prompt_config.sql", "0006_lead_research_run.sql", "0007_core_target_identities.sql", "0008_migration_ledger.sql",
      "0009_authority_kernel.sql", "0010_authority_hardening.sql", "0011_execution_run_kernel.sql",
    ];
    try {
      for (const migration of migrationNames) {
        cpSync(join(migrationsDirectory, migration), join(legacyMigrations, migration));
      }
      runWrangler(["d1", "migrations", "apply", databaseName, "--local", "--config", configPath], upgradeRoot);
      const legacyQuery = (statement: string) => {
        const output = runWrangler(["d1", "execute", databaseName, "--local", "--config", configPath, "--command", statement, "--json"], upgradeRoot);
        return (JSON.parse(output) as Array<{ results?: Array<{ value: number }> }>)[0]?.results ?? [];
      };
      expect(Number(legacyQuery("SELECT COUNT(*) AS value FROM d1_migrations")[0]?.value)).toBe(11);
      expect(Number(legacyQuery("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'CostEntry'")[0]?.value)).toBe(0);
      cpSync(join(migrationsDirectory, "0012_cost_entry_core.sql"), join(legacyMigrations, "0012_cost_entry_core.sql"));
      runWrangler(["d1", "migrations", "apply", databaseName, "--local", "--config", configPath], upgradeRoot);
      expect(Number(legacyQuery("SELECT COUNT(*) AS value FROM d1_migrations")[0]?.value)).toBe(12);
      expect(Number(legacyQuery("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'CostEntry'")[0]?.value)).toBe(1);
      expect(runWrangler(["d1", "migrations", "apply", databaseName, "--local", "--config", configPath], upgradeRoot)).toContain("No migrations to apply");
    } finally {
      rmSync(upgradeRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
