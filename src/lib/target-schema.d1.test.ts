import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const repositoryRoot = process.cwd();
const wranglerEntry = join(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const defaultDatabaseName = "standloud-crm-prod";
const localDatabaseId = "5e3373f0-79c0-452b-8f51-abfcb23b2931";
const timestamp = "2026-10-07T00:00:00.000Z";

let temporaryRoot: string;
let cleanPersistPath: string;
let miniflare: Miniflare;

type LocalD1PreparedStatement = {
  bind(...values: unknown[]): LocalD1PreparedStatement;
};

type LocalD1Result = {
  results?: Array<Record<string, unknown>>;
};

type LocalD1Database = {
  prepare(query: string): LocalD1PreparedStatement;
  batch(statements: LocalD1PreparedStatement[]): Promise<LocalD1Result[]>;
};

let database: LocalD1Database;

type CommandFailure = Error & { stdout?: string | Buffer; stderr?: string | Buffer };

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

function splitStatements(statement: string) {
  return statement.split(";").map((part) => part.trim()).filter(Boolean);
}

async function executeSql(statement: string) {
  return database.batch(splitStatements(statement).map((query) => database.prepare(query)));
}

async function queryRows(statement: string) {
  const [result] = await executeSql(statement);
  return result?.results ?? [];
}

async function countRows(statement: string) {
  const row = (await queryRows(statement))[0];
  return Number(row?.total);
}

function errorText(error: unknown) {
  const commandFailure = error as CommandFailure;
  return [
    commandFailure.message,
    commandFailure.stdout?.toString(),
    commandFailure.stderr?.toString(),
  ].filter(Boolean).join("\n");
}

async function expectSqlFailure(statement: string, expectedMarker?: string) {
  let thrown: unknown;
  try {
    await executeSql(statement);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  if (expectedMarker) expect(errorText(thrown)).toContain(expectedMarker);
}

async function insertCandidate(id: string, experimentId: string, businessId: string | null, status: string) {
  const business = businessId === null ? "NULL" : `'${businessId}'`;
  await executeSql(`INSERT INTO "Candidate" ("id", "experimentId", "businessId", "status", "discoveryTrace", "updatedAt") VALUES ('${id}', '${experimentId}', ${business}, '${status}', 'fixture:${id}', '${timestamp}')`);
}

async function insertCase(id: string, experimentId: string, businessId: string, stage = "RESEARCH") {
  await executeSql(`INSERT INTO "CommercialCase" ("id", "experimentId", "businessId", "stage", "updatedAt") VALUES ('${id}', '${experimentId}', '${businessId}', '${stage}', '${timestamp}')`);
}

function createLegacyConfig(configDirectory: string) {
  const migrationsDirectory = join(configDirectory, "migrations");
  mkdirSync(migrationsDirectory, { recursive: true });
  writeFileSync(join(configDirectory, "wrangler.json"), JSON.stringify({
    name: "tr01c-legacy-upgrade",
    compatibility_date: "2026-09-20",
    d1_databases: [{
      binding: "DB",
      database_name: "tr01c-legacy-upgrade",
      database_id: "11111111-1111-4111-8111-111111111111",
      migrations_dir: "migrations",
    }],
  }));
  return { configPath: join(configDirectory, "wrangler.json"), migrationsDirectory };
}

describe("TR-01C real disposable D1 target schema", () => {
  beforeAll(async () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), "standloud-tr01c-"));
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
  }, 120_000);

  afterAll(async () => {
    await miniflare?.dispose();
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("bootstraps all eleven migrations with target tables, indexes, and triggers", async () => {
    expect(await countRows("SELECT COUNT(*) AS total FROM d1_migrations")).toBe(11);
    expect(await countRows("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name IN ('Experiment', 'Business', 'Candidate', 'CommercialCase', 'CommercialCaseOrigin', 'Contact', 'ContactPoint', 'Actor')")).toBe(8);
    expect(await countRows("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'trigger' AND name IN ('CommercialCase_birth_requires_research', 'CommercialCaseOrigin_insert_requires_coherent_candidate', 'Candidate_origin_lineage_immutable', 'CommercialCase_origin_identity_immutable')")).toBe(4);
    expect(await countRows("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'index' AND name = 'CommercialCaseOrigin_candidateId_idx'")).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"Business\"")).toBe(0);
  }, 120_000);

  it("upgrades a disposable 0001..0002 state through 0011 without legacy or target rows", () => {
    const upgradeRoot = join(temporaryRoot, "legacy-upgrade");
    const { configPath, migrationsDirectory } = createLegacyConfig(upgradeRoot);
    const migrationFiles = ["0001_init.sql", "0002_agent_audit_log.sql", "0003_lead_research.sql", "0004_scout_candidate_review.sql", "0005_agent_prompt_config.sql", "0006_lead_research_run.sql", "0007_core_target_identities.sql", "0008_migration_ledger.sql", "0009_authority_kernel.sql", "0010_authority_hardening.sql", "0011_execution_run_kernel.sql"];

    for (const migration of migrationFiles.slice(0, 2)) {
      cpSync(join(repositoryRoot, "prisma", "migrations", migration), join(migrationsDirectory, migration));
    }
    const legacyPersistPath = join(upgradeRoot, "persist");
    runWrangler(["d1", "migrations", "apply", "tr01c-legacy-upgrade", "--config", configPath, "--local", "--persist-to", legacyPersistPath]);

    for (const migration of migrationFiles.slice(2)) {
      cpSync(join(repositoryRoot, "prisma", "migrations", migration), join(migrationsDirectory, migration));
    }
    runWrangler(["d1", "migrations", "apply", "tr01c-legacy-upgrade", "--config", configPath, "--local", "--persist-to", legacyPersistPath]);

    const legacyRows = (statement: string) => {
      const output = runWrangler([...d1Args(legacyPersistPath, "tr01c-legacy-upgrade", configPath), "--command", statement, "--json"]);
      return (JSON.parse(output) as Array<{ results?: Array<Record<string, unknown>> }>)[0]?.results ?? [];
    };
    const legacyCount = (statement: string) => Number(legacyRows(statement)[0]?.total);
    expect(legacyCount("SELECT COUNT(*) AS total FROM d1_migrations")).toBe(11);
    expect(legacyCount("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'Lead'")).toBe(1);
    expect(legacyCount("SELECT COUNT(*) AS total FROM \"Experiment\"")).toBe(0);
  }, 120_000);

  it("enforces Candidate identity and RESEARCH Business requirements", async () => {
    await executeSql(`INSERT INTO "Experiment" ("id") VALUES ('experiment-1'); INSERT INTO "Experiment" ("id") VALUES ('experiment-2'); INSERT INTO "Business" ("id") VALUES ('business-1'); INSERT INTO "Business" ("id") VALUES ('business-2')`);

    await expectSqlFailure(`INSERT INTO "Candidate" ("id", "experimentId", "status", "discoveryTrace", "updatedAt") VALUES ('candidate-missing-experiment', 'missing-experiment', 'DISCOVERED', 'fixture', '${timestamp}')`);
    await expectSqlFailure(`INSERT INTO "Candidate" ("id", "experimentId", "status", "discoveryTrace", "updatedAt") VALUES ('candidate-research-no-business', 'experiment-1', 'RESEARCH', 'fixture', '${timestamp}')`);
    await expectSqlFailure(`INSERT INTO "Candidate" ("id", "experimentId", "status", "discoveryTrace", "updatedAt") VALUES ('candidate-invalid-status', 'experiment-1', 'INVALID', 'fixture', '${timestamp}')`);

    await insertCandidate("candidate-discovered", "experiment-1", "business-1", "DISCOVERED");
    await insertCandidate("candidate-uncertain", "experiment-1", "business-1", "UNCERTAIN");
    await insertCandidate("candidate-research-1", "experiment-1", "business-1", "RESEARCH");
    await insertCandidate("candidate-research-2", "experiment-1", "business-1", "RESEARCH");
    await insertCandidate("candidate-wrong-experiment", "experiment-2", "business-1", "RESEARCH");
    await insertCandidate("candidate-wrong-business", "experiment-1", "business-2", "RESEARCH");
  }, 120_000);

  it("keeps Business independent from Lead and protects CommercialCase birth", async () => {
    expect(await queryRows("PRAGMA foreign_key_list('Business')")).toEqual([]);
    expect(await countRows("SELECT COUNT(*) AS total FROM pragma_table_info('Lead') WHERE name = 'companyName'")).toBe(1);

    await expectSqlFailure(`INSERT INTO "CommercialCase" ("id", "experimentId", "businessId", "stage", "updatedAt") VALUES ('case-missing-experiment', 'missing', 'business-1', 'RESEARCH', '${timestamp}')`);
    await expectSqlFailure(`INSERT INTO "CommercialCase" ("id", "experimentId", "businessId", "stage", "updatedAt") VALUES ('case-missing-business', 'experiment-1', 'missing', 'RESEARCH', '${timestamp}')`);
    await expectSqlFailure(`INSERT INTO "CommercialCase" ("id", "experimentId", "businessId", "stage", "updatedAt") VALUES ('case-wrong-birth-stage', 'experiment-1', 'business-1', 'DIAGNOSIS', '${timestamp}')`, "COMMERCIAL_CASE_BIRTH_STAGE_MUST_BE_RESEARCH");

    await insertCase("case-1", "experiment-1", "business-1");
    await insertCase("case-2", "experiment-1", "business-1");
    await insertCase("case-stage-check", "experiment-1", "business-1");
    await expectSqlFailure(`UPDATE "CommercialCase" SET "stage" = 'INVALID' WHERE "id" = 'case-stage-check'`);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"CommercialCase\" WHERE \"id\" IN ('case-1', 'case-2') AND \"experimentId\" = 'experiment-1' AND \"businessId\" = 'business-1'")).toBe(2);
  }, 120_000);

  it("enforces origin coherence without imposing reverse Candidate to Case uniqueness", async () => {
    await executeSql(`INSERT INTO "CommercialCaseOrigin" ("commercialCaseId", "candidateId") VALUES ('case-1', 'candidate-research-1'); INSERT INTO "CommercialCaseOrigin" ("commercialCaseId", "candidateId") VALUES ('case-1', 'candidate-research-2'); INSERT INTO "CommercialCaseOrigin" ("commercialCaseId", "candidateId") VALUES ('case-2', 'candidate-research-1')`);

    await expectSqlFailure(`INSERT INTO "CommercialCaseOrigin" ("commercialCaseId", "candidateId") VALUES ('case-1', 'candidate-research-1')`);
    await expectSqlFailure(`INSERT INTO "CommercialCaseOrigin" ("commercialCaseId", "candidateId") VALUES ('case-1', 'candidate-wrong-experiment')`, "COMMERCIAL_CASE_ORIGIN_COHERENCE_VIOLATION");
    await expectSqlFailure(`INSERT INTO "CommercialCaseOrigin" ("commercialCaseId", "candidateId") VALUES ('case-1', 'candidate-wrong-business')`, "COMMERCIAL_CASE_ORIGIN_COHERENCE_VIOLATION");
    await expectSqlFailure(`INSERT INTO "CommercialCaseOrigin" ("commercialCaseId", "candidateId") VALUES ('case-1', 'candidate-discovered')`, "COMMERCIAL_CASE_ORIGIN_COHERENCE_VIOLATION");

    expect(await countRows("SELECT COUNT(*) AS total FROM \"CommercialCaseOrigin\" WHERE \"candidateId\" = 'candidate-research-1'")).toBe(2);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"CommercialCaseOrigin\" WHERE \"commercialCaseId\" = 'case-1'")).toBe(2);
  }, 120_000);

  it("rolls back an invalid Case plus first-origin D1 batch and commits a valid one", async () => {
    await expectSqlFailure(`INSERT INTO "CommercialCase" ("id", "experimentId", "businessId", "stage", "updatedAt") VALUES ('case-invalid-batch', 'experiment-1', 'business-1', 'RESEARCH', '${timestamp}'); INSERT INTO "CommercialCaseOrigin" ("commercialCaseId", "candidateId") VALUES ('case-invalid-batch', 'candidate-discovered')`, "COMMERCIAL_CASE_ORIGIN_COHERENCE_VIOLATION");
    expect(await countRows("SELECT COUNT(*) AS total FROM \"CommercialCase\" WHERE \"id\" = 'case-invalid-batch'")).toBe(0);

    await executeSql(`INSERT INTO "CommercialCase" ("id", "experimentId", "businessId", "stage", "updatedAt") VALUES ('case-valid-batch', 'experiment-1', 'business-1', 'RESEARCH', '${timestamp}'); INSERT INTO "CommercialCaseOrigin" ("commercialCaseId", "candidateId") VALUES ('case-valid-batch', 'candidate-research-2')`);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"CommercialCase\" WHERE \"id\" = 'case-valid-batch'")).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"CommercialCaseOrigin\" WHERE \"commercialCaseId\" = 'case-valid-batch' AND \"candidateId\" = 'candidate-research-2'")).toBe(1);
  }, 120_000);

  it("freezes Candidate and Case lineage fields after an origin exists", async () => {
    await expectSqlFailure(`UPDATE "Candidate" SET "experimentId" = 'experiment-2' WHERE "id" = 'candidate-research-1'`, "CANDIDATE_ORIGIN_LINEAGE_IMMUTABLE");
    await expectSqlFailure(`UPDATE "Candidate" SET "businessId" = 'business-2' WHERE "id" = 'candidate-research-1'`, "CANDIDATE_ORIGIN_LINEAGE_IMMUTABLE");
    await expectSqlFailure(`UPDATE "Candidate" SET "status" = 'DISCARD' WHERE "id" = 'candidate-research-1'`, "CANDIDATE_ORIGIN_LINEAGE_IMMUTABLE");
    await expectSqlFailure(`UPDATE "CommercialCase" SET "experimentId" = 'experiment-2' WHERE "id" = 'case-1'`, "COMMERCIAL_CASE_ORIGIN_IDENTITY_IMMUTABLE");
    await expectSqlFailure(`UPDATE "CommercialCase" SET "businessId" = 'business-2' WHERE "id" = 'case-1'`, "COMMERCIAL_CASE_ORIGIN_IDENTITY_IMMUTABLE");
  }, 120_000);

  it("enforces Contact and ContactPoint ownership without cascades", async () => {
    await expectSqlFailure(`INSERT INTO "Contact" ("id", "businessId") VALUES ('contact-missing-business', 'missing')`);
    await expectSqlFailure(`INSERT INTO "ContactPoint" ("id", "businessId", "kind", "address", "updatedAt") VALUES ('point-missing-business', 'missing', 'EMAIL', 'missing@example.com', '${timestamp}')`);

    await executeSql(`INSERT INTO "Contact" ("id", "businessId") VALUES ('contact-1', 'business-1'); INSERT INTO "ContactPoint" ("id", "businessId", "kind", "address", "updatedAt") VALUES ('point-without-contact', 'business-1', 'EMAIL', 'hello@example.com', '${timestamp}')`);
    await expectSqlFailure(`INSERT INTO "ContactPoint" ("id", "businessId", "contactId", "kind", "address", "updatedAt") VALUES ('point-missing-contact-business', 'business-1', 'contact-1', 'EMAIL', 'a@example.com', '${timestamp}')`);
    await expectSqlFailure(`INSERT INTO "ContactPoint" ("id", "businessId", "contactBusinessId", "kind", "address", "updatedAt") VALUES ('point-missing-contact-id', 'business-1', 'business-1', 'EMAIL', 'b@example.com', '${timestamp}')`);
    await expectSqlFailure(`INSERT INTO "ContactPoint" ("id", "businessId", "contactId", "contactBusinessId", "kind", "address", "updatedAt") VALUES ('point-cross-business', 'business-2', 'contact-1', 'business-2', 'EMAIL', 'c@example.com', '${timestamp}')`);

    await executeSql(`INSERT INTO "ContactPoint" ("id", "businessId", "contactId", "contactBusinessId", "kind", "address", "updatedAt") VALUES ('point-same-business', 'business-1', 'contact-1', 'business-1', 'EMAIL', 'valid@example.com', '${timestamp}')`);
    await expectSqlFailure(`DELETE FROM "Business" WHERE "id" = 'business-1'`);
  }, 120_000);

  it("uses only frozen Actor categories", async () => {
    for (const category of ["HUMAN", "SYSTEM", "AI", "TOOL_ENABLED_AI", "EXTERNAL_PARTY"]) {
      await executeSql(`INSERT INTO "Actor" ("id", "category") VALUES ('actor-${category}', '${category}')`);
    }
    await expectSqlFailure(`INSERT INTO "Actor" ("id", "category") VALUES ('actor-deterministic', 'DETERMINISTIC_SYSTEM')`);
    await expectSqlFailure(`INSERT INTO "Actor" ("id", "category") VALUES ('actor-reasoning', 'REASONING_AI')`);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"Actor\"")).toBe(5);
  }, 120_000);

  it("reapplies 0001 through 0011 as a no-op on the clean disposable state", () => {
    const output = runWrangler([
      "d1",
      "migrations",
      "apply",
      defaultDatabaseName,
      "--local",
      "--persist-to",
      cleanPersistPath,
    ]);
    expect(output).toMatch(/No migrations to apply/i);
  }, 120_000);
});
