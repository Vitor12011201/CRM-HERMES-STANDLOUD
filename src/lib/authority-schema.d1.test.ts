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
const laterTimestamp = "2026-10-08T00:00:00.000Z";

type LocalD1PreparedStatement = {
  bind(...values: unknown[]): LocalD1PreparedStatement;
};

type LocalD1Result = {
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

async function executeStatement(statement: string) {
  return database.batch([database.prepare(statement)]);
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
    error instanceof Error ? error.message : String(error),
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

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sha(character: string) {
  return character.repeat(64);
}

function governanceConditions(
  familyKind: "POLICY" | "ELIGIBILITY_RULESET",
  familyKey: string,
  predecessorId: string,
  nextRevision: number,
  recordKind: string,
  contentSha256: string,
) {
  return JSON.stringify({
    familyKind,
    familyKey,
    expectedPredecessorId: predecessorId,
    nextRevision,
    recordKind,
    proposedContentSha256: contentSha256,
  });
}

async function insertGovernanceDecision(input: {
  id: string;
  subjectRefId: string;
  conditions: string;
}) {
  await executeSql(`
INSERT INTO "Decision" (
  "id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId",
  "basisPolicyVersionId", "conditionsSchemaKey", "conditionsJson", "conditionsSha256", "issuedAt"
) VALUES (
  ${quote(input.id)}, ${quote(`request:${input.id}`)}, 'AUTHORITY_POLICY_GOVERNANCE', 'APPROVED', 'actor-principal', ${quote(input.subjectRefId)},
  'policy-governance-1', 'authority-kernel-governance-proposal/v1', ${quote(input.conditions)}, ${quote(sha("d"))}, ${quote(timestamp)}
)
`);
}

function createLegacyConfig(configDirectory: string) {
  const migrationsDirectory = join(configDirectory, "migrations");
  mkdirSync(migrationsDirectory, { recursive: true });
  writeFileSync(join(configDirectory, "wrangler.json"), JSON.stringify({
    name: "tr03b-legacy-upgrade",
    compatibility_date: "2026-09-20",
    d1_databases: [{
      binding: "DB",
      database_name: "tr03b-legacy-upgrade",
      database_id: "22222222-2222-4222-8222-222222222222",
      migrations_dir: "migrations",
    }],
  }));
  return { configPath: join(configDirectory, "wrangler.json"), migrationsDirectory };
}

describe("TR-03B real disposable D1 authority kernel", () => {
  beforeAll(async () => {
    temporaryRoot = mkdtempSync(join(tmpdir(), "standloud-tr03b-"));
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

  it("cleanly bootstraps 0001 through 0012 with exactly the authority-kernel tables and no authority rows", async () => {
    const authorityTables = [
      "AuthorityBootstrapReceipt",
      "AuthoritySubjectRef",
      "AuthorityPolicyVersion",
      "ExecutorEligibilityRuleSetVersion",
      "ExecutorEligibilityRule",
      "Decision",
      "AuthorityRelation",
      "DelegationGrant",
      "AuthorityInvocation",
    ];
    const quotedTables = authorityTables.map(quote).join(", ");
    expect(await countRows("SELECT COUNT(*) AS total FROM d1_migrations")).toBe(12);
    expect(await countRows(`SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name IN (${quotedTables})`)).toBe(9);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"AuthorityBootstrapReceipt\"")).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"AuthorityInvocation\"")).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'trigger' AND name = 'AuthorityInvocation_generic_guard' ")).toBe(1);
  }, 120_000);

  it("upgrades the approved legacy 0001 + 0002 + 0007 + 0008 state through 0011 and reapplies as a no-op", () => {
    const upgradeRoot = join(temporaryRoot, "legacy-upgrade");
    const { configPath, migrationsDirectory } = createLegacyConfig(upgradeRoot);
    const legacyMigrationFiles = [
      "0001_init.sql",
      "0002_agent_audit_log.sql",
      "0007_core_target_identities.sql",
      "0008_migration_ledger.sql",
    ];
    for (const migration of legacyMigrationFiles) {
      cpSync(join(repositoryRoot, "prisma", "migrations", migration), join(migrationsDirectory, migration));
    }
    const legacyPersistPath = join(upgradeRoot, "persist");
    runWrangler(["d1", "migrations", "apply", "tr03b-legacy-upgrade", "--config", configPath, "--local", "--persist-to", legacyPersistPath]);
    cpSync(join(repositoryRoot, "prisma", "migrations", "0009_authority_kernel.sql"), join(migrationsDirectory, "0009_authority_kernel.sql"));
    cpSync(join(repositoryRoot, "prisma", "migrations", "0010_authority_hardening.sql"), join(migrationsDirectory, "0010_authority_hardening.sql"));
    cpSync(join(repositoryRoot, "prisma", "migrations", "0011_execution_run_kernel.sql"), join(migrationsDirectory, "0011_execution_run_kernel.sql"));
    runWrangler(["d1", "migrations", "apply", "tr03b-legacy-upgrade", "--config", configPath, "--local", "--persist-to", legacyPersistPath]);
    const output = runWrangler([...d1Args(legacyPersistPath, "tr03b-legacy-upgrade", configPath), "--command", "SELECT COUNT(*) AS total FROM d1_migrations", "--json"]);
    const applied = (JSON.parse(output) as Array<{ results?: Array<Record<string, unknown>> }>)[0]?.results ?? [];
    expect(Number(applied[0]?.total)).toBe(7);
    const reapply = runWrangler(["d1", "migrations", "apply", "tr03b-legacy-upgrade", "--config", configPath, "--local", "--persist-to", legacyPersistPath]);
    expect(reapply).toMatch(/No migrations to apply/i);
  }, 120_000);

  it("establishes a singleton receipt, durable subject references, bootstrap policies, rulesets, and eligibility rules", async () => {
    await executeSql(`
INSERT INTO "Actor" ("id", "category") VALUES
  ('actor-principal', 'HUMAN'),
  ('actor-human', 'HUMAN'),
  ('actor-system', 'SYSTEM'),
  ('actor-external', 'EXTERNAL_PARTY');
INSERT INTO "AuthorityBootstrapReceipt" ("bootstrapKey", "manifestVersion", "manifestSha256", "manifestSourceRef", "principalActorId", "provisionedAt")
  VALUES ('AUTHORITY_BOOTSTRAP_V1', 'manifest/v1', ${quote(sha("a"))}, 'approved-offline-manifest', 'actor-principal', ${quote(timestamp)});
INSERT INTO "AuthoritySubjectRef" ("id", "registryVersion", "subjectType", "subjectId", "versionKind", "versionToken", "descriptorFormat", "canonicalKey", "descriptorSha256") VALUES
  ('subject-main', 'registry/v1', 'CASE', 'case-001', 'NON_VERSIONED', NULL, 'authority-subject/v1', 'case:case-001', ${quote(sha("b"))}),
  ('subject-policy-chain', 'registry/v1', 'POLICY_FAMILY_DESCRIPTOR', 'policy.chain', 'EXACT_VERSION', 'policy-chain-1', 'authority-subject/v1', 'policy-chain:1', ${quote(sha("c"))}),
  ('subject-policy-wrong', 'registry/v1', 'POLICY_FAMILY_DESCRIPTOR', 'other.policy', 'EXACT_VERSION', 'policy-chain-1', 'authority-subject/v1', 'policy-chain:wrong', ${quote(sha("d"))}),
  ('subject-rules-chain', 'registry/v1', 'ELIGIBILITY_RULESET_FAMILY_DESCRIPTOR', 'rules.chain', 'EXACT_VERSION', 'rules-chain-1', 'authority-subject/v1', 'rules-chain:1', ${quote(sha("e"))}),
  ('subject-rules-chain-2', 'registry/v1', 'ELIGIBILITY_RULESET_FAMILY_DESCRIPTOR', 'rules.chain', 'EXACT_VERSION', 'rules-chain-2', 'authority-subject/v1', 'rules-chain:2', ${quote(sha("f"))}),
  ('subject-rules-invoke', 'registry/v1', 'ELIGIBILITY_RULESET_FAMILY_DESCRIPTOR', 'rules.invoke', 'EXACT_VERSION', 'rules-invoke-1', 'authority-subject/v1', 'rules-invoke:1', ${quote(sha("a"))}),
  ('subject-policy-human', 'registry/v1', 'POLICY_FAMILY_DESCRIPTOR', 'policy.human', 'EXACT_VERSION', 'policy-human-1', 'authority-subject/v1', 'policy-human:1', ${quote(sha("1"))}),
  ('subject-policy-auto', 'registry/v1', 'POLICY_FAMILY_DESCRIPTOR', 'policy.auto', 'EXACT_VERSION', 'policy-auto-1', 'authority-subject/v1', 'policy-auto:1', ${quote(sha("2"))});
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion",
  "definitionJson", "contentSha256", "priorDecisionDisposition", "bootstrapKey"
) VALUES
  ('policy-governance-1', 'policy.governance', 1, 'POLICY', 'AUTHORITY_POLICY_GOVERNANCE', 'HUMAN_GATED', 'scope/v1', '1', '{}', ${quote(sha("3"))}, 'PRESERVE', 'AUTHORITY_BOOTSTRAP_V1'),
  ('policy-chain-1', 'policy.chain', 1, 'POLICY', 'CHAIN_ACTION', 'POLICY_GOVERNED', 'scope/v1', '1', '{}', ${quote(sha("4"))}, 'PRESERVE', 'AUTHORITY_BOOTSTRAP_V1'),
  ('policy-auto-1', 'policy.auto', 1, 'POLICY', 'AUTO_ACTION', 'POLICY_GOVERNED', 'scope/v1', '1', '{}', ${quote(sha("5"))}, 'PRESERVE', 'AUTHORITY_BOOTSTRAP_V1'),
  ('policy-human-1', 'policy.human', 1, 'POLICY', 'HUMAN_ACTION', 'HUMAN_GATED', 'scope/v1', '1', '{}', ${quote(sha("6"))}, 'PRESERVE', 'AUTHORITY_BOOTSTRAP_V1'),
  ('policy-delegated-1', 'policy.delegated', 1, 'POLICY', 'DELEGATED_ACTION', 'DELEGATED', 'scope/v1', '1', '{}', ${quote(sha("7"))}, 'PRESERVE', 'AUTHORITY_BOOTSTRAP_V1');
INSERT INTO "ExecutorEligibilityRuleSetVersion" (
  "id", "ruleSetKey", "revision", "recordKind", "contractCatalogRevision", "contentSha256", "bootstrapKey"
) VALUES
  ('rules-chain-1', 'rules.chain', 1, 'RULESET', 'catalog/v1', ${quote(sha("8"))}, 'AUTHORITY_BOOTSTRAP_V1'),
  ('rules-invoke-1', 'rules.invoke', 1, 'RULESET', 'catalog/v1', ${quote(sha("9"))}, 'AUTHORITY_BOOTSTRAP_V1');
INSERT INTO "ExecutorEligibilityRule" (
  "id", "ruleSetVersionId", "capabilityKey", "contractVariantKey", "executorType", "verdict", "ruleSha256"
) VALUES
  ('rule-auto', 'rules-invoke-1', 'cap.auto', 'DEFAULT', 'DETERMINISTIC_SYSTEM', 'ELIGIBLE', ${quote(sha("a"))}),
  ('rule-human', 'rules-invoke-1', 'cap.human', 'DEFAULT', 'HUMAN_EXECUTOR', 'ELIGIBLE', ${quote(sha("b"))}),
  ('rule-delegated', 'rules-invoke-1', 'cap.delegated', 'DEFAULT', 'DETERMINISTIC_SYSTEM', 'ELIGIBLE', ${quote(sha("c"))}),
  ('rule-ineligible', 'rules-invoke-1', 'cap.ineligible', 'DEFAULT', 'DETERMINISTIC_SYSTEM', 'INELIGIBLE', ${quote(sha("d"))});
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityBootstrapReceipt" ("bootstrapKey", "manifestVersion", "manifestSha256", "manifestSourceRef", "principalActorId", "provisionedAt")
VALUES ('not-the-static-key', 'manifest/v2', ${quote(sha("e"))}, 'bad', 'actor-human', ${quote(timestamp)})
`);
    await expectSqlFailure(`INSERT INTO "AuthoritySubjectRef" ("id", "registryVersion", "subjectType", "subjectId", "versionKind", "versionToken", "descriptorFormat", "canonicalKey", "descriptorSha256") VALUES ('subject-invalid', 'registry/v1', 'CASE', 'case-invalid', 'NON_VERSIONED', 'forbidden', 'authority-subject/v1', 'case:case-invalid', ${quote(sha("f"))})`);
    await expectSqlFailure(`INSERT INTO "AuthoritySubjectRef" ("id", "registryVersion", "subjectType", "subjectId", "versionKind", "versionToken", "descriptorFormat", "canonicalKey", "descriptorSha256") VALUES ('subject-duplicate-key', 'registry/v1', 'CASE', 'case-duplicate', 'NON_VERSIONED', NULL, 'authority-subject/v1', 'case:case-001', ${quote(sha("1"))})`);
  });

  it("requires a strict policy-version chain and an exact governance descriptor", async () => {
    await expectSqlFailure(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId"
) VALUES ('policy-chain-wrong-parent', 'other.policy', 2, 'policy-chain-1', 'POLICY', 'CHAIN_ACTION', 'POLICY_GOVERNED', 'scope/v1', '1', '{}', ${quote(sha("e"))}, 'PRESERVE', 'missing')
`, "AUTHORITY_POLICY_PREDECESSOR_MISMATCH");

    await insertGovernanceDecision({
      id: "decision-policy-chain-wrong",
      subjectRefId: "subject-policy-wrong",
      conditions: governanceConditions("POLICY", "policy.chain", "policy-chain-1", 2, "POLICY", sha("e")),
    });
    await expectSqlFailure(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId"
) VALUES ('policy-chain-bad-descriptor', 'policy.chain', 2, 'policy-chain-1', 'POLICY', 'CHAIN_ACTION', 'POLICY_GOVERNED', 'scope/v1', '1', '{}', ${quote(sha("e"))}, 'PRESERVE', 'decision-policy-chain-wrong')
`, "AUTHORITY_POLICY_GOVERNANCE_DESCRIPTOR_MISMATCH");

    await insertGovernanceDecision({
      id: "decision-policy-chain-good",
      subjectRefId: "subject-policy-chain",
      conditions: governanceConditions("POLICY", "policy.chain", "policy-chain-1", 2, "POLICY", sha("e")),
    });
    await executeSql(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId"
) VALUES ('policy-chain-2', 'policy.chain', 2, 'policy-chain-1', 'POLICY', 'CHAIN_ACTION', 'POLICY_GOVERNED', 'scope/v1', '1', '{}', ${quote(sha("e"))}, 'PRESERVE', 'decision-policy-chain-good')
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId"
) VALUES ('policy-chain-fork', 'policy.chain', 2, 'policy-chain-1', 'POLICY', 'CHAIN_ACTION', 'POLICY_GOVERNED', 'scope/v1', '1', '{}', ${quote(sha("f"))}, 'PRESERVE', 'decision-policy-chain-good')
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId"
) VALUES ('policy-chain-skip', 'policy.chain', 4, 'policy-chain-2', 'POLICY', 'CHAIN_ACTION', 'POLICY_GOVERNED', 'scope/v1', '1', '{}', ${quote(sha("f"))}, 'PRESERVE', 'decision-policy-chain-good')
`, "AUTHORITY_POLICY_PREDECESSOR_MISMATCH");
  });

  it("requires a strict eligibility-ruleset chain, exact descriptor, and rules only under active RULESET rows", async () => {
    await expectSqlFailure(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" ("id", "ruleSetKey", "revision", "predecessorRuleSetVersionId", "recordKind", "contractCatalogRevision", "contentSha256", "governanceDecisionId")
VALUES ('rules-chain-skip', 'rules.chain', 3, 'rules-chain-1', 'RULESET', 'catalog/v1', ${quote(sha("a"))}, 'missing')
`, "ELIGIBILITY_RULESET_PREDECESSOR_MISMATCH");
    await insertGovernanceDecision({
      id: "decision-rules-chain-wrong",
      subjectRefId: "subject-policy-wrong",
      conditions: governanceConditions("ELIGIBILITY_RULESET", "rules.chain", "rules-chain-1", 2, "RULESET", sha("a")),
    });
    await expectSqlFailure(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" ("id", "ruleSetKey", "revision", "predecessorRuleSetVersionId", "recordKind", "contractCatalogRevision", "contentSha256", "governanceDecisionId")
VALUES ('rules-chain-bad-descriptor', 'rules.chain', 2, 'rules-chain-1', 'RULESET', 'catalog/v1', ${quote(sha("a"))}, 'decision-rules-chain-wrong')
`, "ELIGIBILITY_RULESET_GOVERNANCE_DESCRIPTOR_MISMATCH");
    await insertGovernanceDecision({
      id: "decision-rules-chain-good",
      subjectRefId: "subject-rules-chain",
      conditions: governanceConditions("ELIGIBILITY_RULESET", "rules.chain", "rules-chain-1", 2, "RULESET", sha("a")),
    });
    await executeSql(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" ("id", "ruleSetKey", "revision", "predecessorRuleSetVersionId", "recordKind", "contractCatalogRevision", "contentSha256", "governanceDecisionId")
VALUES ('rules-chain-2', 'rules.chain', 2, 'rules-chain-1', 'RULESET', 'catalog/v1', ${quote(sha("a"))}, 'decision-rules-chain-good')
`);
    await insertGovernanceDecision({
      id: "decision-rules-chain-disabled",
      subjectRefId: "subject-rules-chain-2",
      conditions: governanceConditions("ELIGIBILITY_RULESET", "rules.chain", "rules-chain-2", 3, "DISABLED", sha("b")),
    });
    await executeSql(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" ("id", "ruleSetKey", "revision", "predecessorRuleSetVersionId", "recordKind", "contractCatalogRevision", "contentSha256", "governanceDecisionId")
VALUES ('rules-chain-3-disabled', 'rules.chain', 3, 'rules-chain-2', 'DISABLED', 'catalog/v1', ${quote(sha("b"))}, 'decision-rules-chain-disabled')
`);
    await expectSqlFailure(`
INSERT INTO "ExecutorEligibilityRule" ("id", "ruleSetVersionId", "capabilityKey", "contractVariantKey", "executorType", "verdict", "ruleSha256")
VALUES ('rule-under-disabled-set', 'rules-chain-3-disabled', 'cap.any', 'DEFAULT', 'HUMAN_EXECUTOR', 'ELIGIBLE', ${quote(sha("c"))})
`, "ELIGIBILITY_RULE_PARENT_NOT_RULESET");
  });

  it("records only a generic policy-governed invocation with current policy, current ruleset, and exact eligible rule", async () => {
    await executeSql(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "contractVariantKey", "executorActorId", "executorType",
  "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES (
  'invocation-auto-valid', 'invoke:auto:valid', ${quote(sha("a"))}, 'AUTO_ACTION', 'cap.auto', NULL, 'actor-system', 'DETERMINISTIC_SYSTEM',
  'subject-main', 'policy-auto-1', 'rules-invoke-1', 'rule-auto', 'AUTHORIZED', ${quote(sha("b"))}, ${quote(timestamp)}
)
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-ineligible', 'invoke:ineligible', ${quote(sha("c"))}, 'AUTO_ACTION', 'cap.ineligible', 'actor-system', 'DETERMINISTIC_SYSTEM', 'subject-main', 'policy-auto-1', 'rules-invoke-1', 'rule-ineligible', 'AUTHORIZED', ${quote(sha("d"))}, ${quote(timestamp)})
`, "AUTHORITY_INVOCATION_RULE_MISMATCH");
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-external', 'invoke:external', ${quote(sha("e"))}, 'AUTO_ACTION', 'cap.auto', 'actor-external', 'DETERMINISTIC_SYSTEM', 'subject-main', 'policy-auto-1', 'rules-invoke-1', 'rule-auto', 'AUTHORIZED', ${quote(sha("f"))}, ${quote(timestamp)})
`, "AUTHORITY_INVOCATION_EXTERNAL_PARTY_EXECUTOR");
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "contractVariantKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-variant-mismatch', 'invoke:variant-mismatch', ${quote(sha("1"))}, 'AUTO_ACTION', 'cap.auto', 'NON_DEFAULT', 'actor-system', 'DETERMINISTIC_SYSTEM', 'subject-main', 'policy-auto-1', 'rules-invoke-1', 'rule-auto', 'AUTHORIZED', ${quote(sha("2"))}, ${quote(timestamp)})
`, "AUTHORITY_INVOCATION_RULE_MISMATCH");
  });

  it("uses a matching human decision once and permanently invalidates it after a revocation successor", async () => {
    await executeSql(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt")
VALUES ('decision-human-1', 'request:human:1', 'HUMAN_ACTION', 'APPROVED', 'actor-human', 'subject-main', 'policy-human-1', ${quote(timestamp)});
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "decisionId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-human-valid', 'invoke:human:valid', ${quote(sha("3"))}, 'HUMAN_ACTION', 'cap.human', 'actor-human', 'HUMAN_EXECUTOR', 'subject-main', 'policy-human-1', 'rules-invoke-1', 'rule-human', 'decision-human-1', 'AUTHORIZED', ${quote(sha("4"))}, ${quote(timestamp)})
`);
    await executeSql(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "scopeRootSubjectRefId", "basisPolicyVersionId", "issuedAt") VALUES
  ('decision-human-nonhuman', 'request:human:nonhuman', 'HUMAN_ACTION', 'APPROVED', 'actor-system', 'subject-main', NULL, 'policy-human-1', ${quote(timestamp)}),
  ('decision-human-scoped', 'request:human:scoped', 'HUMAN_ACTION', 'APPROVED', 'actor-human', 'subject-main', 'subject-main', 'policy-human-1', ${quote(timestamp)});
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "decisionId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-human-nonhuman', 'invoke:human:nonhuman', ${quote(sha("e"))}, 'HUMAN_ACTION', 'cap.human', 'actor-human', 'HUMAN_EXECUTOR', 'subject-main', 'policy-human-1', 'rules-invoke-1', 'rule-human', 'decision-human-nonhuman', 'AUTHORIZED', ${quote(sha("f"))}, ${quote(timestamp)})
`, "AUTHORITY_INVOCATION_HUMAN_GATED_MISMATCH");
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "caseSubjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "decisionId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-human-scope-mismatch', 'invoke:human:scope-mismatch', ${quote(sha("1"))}, 'HUMAN_ACTION', 'cap.human', 'actor-human', 'HUMAN_EXECUTOR', 'subject-main', NULL, 'policy-human-1', 'rules-invoke-1', 'rule-human', 'decision-human-scoped', 'AUTHORIZED', ${quote(sha("2"))}, ${quote(timestamp)})
`, "AUTHORITY_INVOCATION_HUMAN_GATED_MISMATCH");
    await insertGovernanceDecision({
      id: "decision-policy-human-revocation",
      subjectRefId: "subject-policy-human",
      conditions: governanceConditions("POLICY", "policy.human", "policy-human-1", 2, "REVOCATION", sha("5")),
    });
    await executeSql(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId", "reasonCode"
) VALUES ('policy-human-2-revoked', 'policy.human', 2, 'policy-human-1', 'REVOCATION', 'HUMAN_ACTION', 'HUMAN_GATED', 'scope/v1', '1', NULL, ${quote(sha("5"))}, 'INVALIDATE', 'decision-policy-human-revocation', 'authority withdrawn')
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "decisionId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-human-revoked', 'invoke:human:revoked', ${quote(sha("6"))}, 'HUMAN_ACTION', 'cap.human', 'actor-human', 'HUMAN_EXECUTOR', 'subject-main', 'policy-human-1', 'rules-invoke-1', 'rule-human', 'decision-human-1', 'AUTHORIZED', ${quote(sha("7"))}, ${quote(laterTimestamp)})
`, "AUTHORITY_INVOCATION_HUMAN_GATED_MISMATCH");
  });

  it("requires active, scope-coherent, unrecalled delegation for delegated invocations", async () => {
    await executeSql(`
INSERT INTO "DelegationGrant" (
  "id", "grantRequestKey", "grantedPolicyVersionId", "delegatorActorId", "delegateActorId", "scopeRootSubjectRefId", "scopeSchemaKey", "scopeJson", "scopeSha256", "validFrom", "validUntil", "grantingPolicyVersionId"
) VALUES ('delegation-1', 'grant:1', 'policy-delegated-1', 'actor-principal', 'actor-system', 'subject-main', 'scope/v1', '{}', ${quote(sha("8"))}, '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'policy-governance-1');
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "caseSubjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "delegationGrantId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-delegated-valid', 'invoke:delegated:valid', ${quote(sha("9"))}, 'DELEGATED_ACTION', 'cap.delegated', 'actor-system', 'DETERMINISTIC_SYSTEM', 'subject-main', 'subject-main', 'policy-delegated-1', 'rules-invoke-1', 'rule-delegated', 'delegation-1', 'AUTHORIZED', ${quote(sha("a"))}, ${quote(timestamp)});
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "delegationGrantId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-delegated-scope-mismatch', 'invoke:delegated:scope-mismatch', ${quote(sha("d"))}, 'DELEGATED_ACTION', 'cap.delegated', 'actor-system', 'DETERMINISTIC_SYSTEM', 'subject-main', 'policy-delegated-1', 'rules-invoke-1', 'rule-delegated', 'delegation-1', 'AUTHORIZED', ${quote(sha("e"))}, ${quote(timestamp)})
`, "AUTHORITY_INVOCATION_DELEGATED_MISMATCH");
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "delegationGrantId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-delegated-expired', 'invoke:delegated:expired', ${quote(sha("b"))}, 'DELEGATED_ACTION', 'cap.delegated', 'actor-system', 'DETERMINISTIC_SYSTEM', 'subject-main', 'policy-delegated-1', 'rules-invoke-1', 'rule-delegated', 'delegation-1', 'AUTHORIZED', ${quote(sha("c"))}, '2026-11-01T00:00:00.000Z')
`, "AUTHORITY_INVOCATION_DELEGATED_MISMATCH");
    await executeSql(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt")
VALUES ('decision-relation-effect', 'request:relation-effect', 'RELATION_ACTION', 'APPROVED', 'actor-principal', 'subject-main', 'policy-governance-1', ${quote(timestamp)});
INSERT INTO "AuthorityRelation" ("id", "effectingDecisionId", "relationKind", "targetDelegationGrantId")
VALUES ('relation-revoke-delegation', 'decision-relation-effect', 'REVOKES', 'delegation-1');
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "delegationGrantId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-delegated-revoked', 'invoke:delegated:revoked', ${quote(sha("b"))}, 'DELEGATED_ACTION', 'cap.delegated', 'actor-system', 'DETERMINISTIC_SYSTEM', 'subject-main', 'policy-delegated-1', 'rules-invoke-1', 'rule-delegated', 'delegation-1', 'AUTHORIZED', ${quote(sha("c"))}, ${quote(timestamp)})
`, "AUTHORITY_INVOCATION_DELEGATED_MISMATCH");
  });

  it("keeps relation history append-only, allows multiple revocations, and rejects duplicate, self, and cyclic supersedence", async () => {
    await executeSql(`
INSERT INTO "Decision" ("id", "decisionRequestKey", "normativeActionKey", "outcomeKey", "decidingActorId", "subjectRefId", "basisPolicyVersionId", "issuedAt") VALUES
  ('decision-graph-a', 'request:graph:a', 'GRAPH_ACTION', 'APPROVED', 'actor-principal', 'subject-main', 'policy-governance-1', ${quote(timestamp)}),
  ('decision-graph-b', 'request:graph:b', 'GRAPH_ACTION', 'APPROVED', 'actor-principal', 'subject-main', 'policy-governance-1', ${quote(timestamp)}),
  ('decision-graph-c', 'request:graph:c', 'GRAPH_ACTION', 'APPROVED', 'actor-principal', 'subject-main', 'policy-governance-1', ${quote(timestamp)});
INSERT INTO "AuthorityRelation" ("id", "effectingDecisionId", "relationKind", "targetDecisionId") VALUES
  ('relation-graph-ba', 'decision-graph-b', 'SUPERSEDES', 'decision-graph-a'),
  ('relation-graph-cb', 'decision-graph-c', 'SUPERSEDES', 'decision-graph-b'),
  ('relation-graph-revoke-a', 'decision-graph-b', 'REVOKES', 'decision-graph-a'),
  ('relation-graph-second-revoke-a', 'decision-graph-c', 'REVOKES', 'decision-graph-a');
`);
    await expectSqlFailure(`INSERT INTO "AuthorityRelation" ("id", "effectingDecisionId", "relationKind", "targetDecisionId") VALUES ('relation-graph-duplicate', 'decision-graph-b', 'REVOKES', 'decision-graph-a')`);
    await expectSqlFailure(`INSERT INTO "AuthorityRelation" ("id", "effectingDecisionId", "relationKind", "targetDecisionId") VALUES ('relation-graph-self', 'decision-graph-a', 'SUPERSEDES', 'decision-graph-a')`, "AUTHORITY_RELATION_SELF_TARGET");
    await expectSqlFailure(`INSERT INTO "AuthorityRelation" ("id", "effectingDecisionId", "relationKind", "targetDecisionId") VALUES ('relation-graph-cycle', 'decision-graph-a', 'SUPERSEDES', 'decision-graph-c')`, "AUTHORITY_RELATION_SUPERSEDES_CYCLE");
    expect(await countRows("SELECT COUNT(*) AS total FROM \"AuthorityRelation\" WHERE \"targetDecisionId\" = 'decision-graph-a' AND \"relationKind\" = 'REVOKES'")).toBe(2);
  });

  it("rejects stale policy and ruleset bindings after a structural successor is committed", async () => {
    await insertGovernanceDecision({
      id: "decision-policy-auto-successor",
      subjectRefId: "subject-policy-auto",
      conditions: governanceConditions("POLICY", "policy.auto", "policy-auto-1", 2, "POLICY", sha("d")),
    });
    await executeSql(`
INSERT INTO "AuthorityPolicyVersion" (
  "id", "policyKey", "revision", "predecessorPolicyVersionId", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "governanceDecisionId"
) VALUES ('policy-auto-2', 'policy.auto', 2, 'policy-auto-1', 'POLICY', 'AUTO_ACTION', 'POLICY_GOVERNED', 'scope/v1', '1', '{}', ${quote(sha("d"))}, 'PRESERVE', 'decision-policy-auto-successor')
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-auto-stale-policy', 'invoke:auto:stale-policy', ${quote(sha("e"))}, 'AUTO_ACTION', 'cap.auto', 'actor-system', 'DETERMINISTIC_SYSTEM', 'subject-main', 'policy-auto-1', 'rules-invoke-1', 'rule-auto', 'AUTHORIZED', ${quote(sha("f"))}, ${quote(laterTimestamp)})
`, "AUTHORITY_INVOCATION_POLICY_GOVERNED_MISMATCH");
    await insertGovernanceDecision({
      id: "decision-rules-invoke-successor",
      subjectRefId: "subject-rules-invoke",
      conditions: governanceConditions("ELIGIBILITY_RULESET", "rules.invoke", "rules-invoke-1", 2, "RULESET", sha("1")),
    });
    await executeSql(`
INSERT INTO "ExecutorEligibilityRuleSetVersion" ("id", "ruleSetKey", "revision", "predecessorRuleSetVersionId", "recordKind", "contractCatalogRevision", "contentSha256", "governanceDecisionId")
VALUES ('rules-invoke-2', 'rules.invoke', 2, 'rules-invoke-1', 'RULESET', 'catalog/v1', ${quote(sha("1"))}, 'decision-rules-invoke-successor')
`);
    await expectSqlFailure(`
INSERT INTO "AuthorityInvocation" (
  "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "outcome", "lineageSha256", "evaluatedAt"
) VALUES ('invocation-auto-stale-ruleset', 'invoke:auto:stale-ruleset', ${quote(sha("2"))}, 'AUTO_ACTION', 'cap.auto', 'actor-system', 'DETERMINISTIC_SYSTEM', 'subject-main', 'policy-auto-2', 'rules-invoke-1', 'rule-auto', 'AUTHORIZED', ${quote(sha("3"))}, ${quote(laterTimestamp)})
`, "AUTHORITY_INVOCATION_RULESET_NOT_CURRENT");
  });

  it("extends the D1 batch contract with a phase guard so a zero-row conditional update cannot commit an authoritative dependent write", async () => {
    await executeSql(`
CREATE TABLE "AuthorityCommitGuardProbe" ("id" TEXT NOT NULL PRIMARY KEY, "phase" TEXT NOT NULL);
CREATE TABLE "AuthorityCommitGuardDependent" ("id" TEXT NOT NULL PRIMARY KEY, "phase" TEXT NOT NULL);
INSERT INTO "AuthorityCommitGuardProbe" ("id", "phase") VALUES ('existing', 'OPEN');
`);
    await executeStatement(`
CREATE TRIGGER "AuthorityCommitGuardDependent_requires_changed_precondition"
BEFORE INSERT ON "AuthorityCommitGuardDependent"
FOR EACH ROW WHEN changes() = 0
BEGIN
  SELECT RAISE(ABORT, 'AUTHORITY_COMMIT_GUARD_ZERO_ROW_PRECONDITION');
END
`);
    await executeSql(`
UPDATE "AuthorityCommitGuardProbe" SET "phase" = 'CLOSED' WHERE "id" = 'missing';
INSERT INTO "AuthorityCommitGuardProbe" ("id", "phase") VALUES ('unsafe-zero-row-follow-on', 'COMMITTED');
`);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"AuthorityCommitGuardProbe\" WHERE \"id\" = 'unsafe-zero-row-follow-on' ")).toBe(1);
    await expectSqlFailure(`
UPDATE "AuthorityCommitGuardProbe" SET "phase" = 'CLOSED' WHERE "id" = 'missing-again';
INSERT INTO "AuthorityCommitGuardDependent" ("id", "phase") VALUES ('blocked-dependent', 'COMMITTED');
`, "AUTHORITY_COMMIT_GUARD_ZERO_ROW_PRECONDITION");
    expect(await countRows("SELECT COUNT(*) AS total FROM \"AuthorityCommitGuardDependent\" WHERE \"id\" = 'blocked-dependent' ")).toBe(0);
    await executeSql(`
UPDATE "AuthorityCommitGuardProbe" SET "phase" = 'CLOSED' WHERE "id" = 'existing';
INSERT INTO "AuthorityCommitGuardDependent" ("id", "phase") VALUES ('guarded-dependent', 'COMMITTED');
`);
    expect(await countRows("SELECT COUNT(*) AS total FROM \"AuthorityCommitGuardDependent\" WHERE \"id\" = 'guarded-dependent' ")).toBe(1);
  });

  it("rejects every update and delete across all nine authority tables", async () => {
    const immutableRows = [
      ["AuthorityBootstrapReceipt", "bootstrapKey", "AUTHORITY_BOOTSTRAP_V1", "manifestSourceRef", "AUTHORITY_BOOTSTRAP_RECEIPT"],
      ["AuthoritySubjectRef", "id", "subject-main", "registryVersion", "AUTHORITY_SUBJECT_REF"],
      ["AuthorityPolicyVersion", "id", "policy-governance-1", "policyKey", "AUTHORITY_POLICY_VERSION"],
      ["ExecutorEligibilityRuleSetVersion", "id", "rules-invoke-1", "ruleSetKey", "ELIGIBILITY_RULESET_VERSION"],
      ["ExecutorEligibilityRule", "id", "rule-auto", "capabilityKey", "ELIGIBILITY_RULE"],
      ["Decision", "id", "decision-human-1", "outcomeKey", "DECISION"],
      ["AuthorityRelation", "id", "relation-graph-ba", "relationKind", "AUTHORITY_RELATION"],
      ["DelegationGrant", "id", "delegation-1", "scopeSchemaKey", "DELEGATION_GRANT"],
      ["AuthorityInvocation", "id", "invocation-auto-valid", "outcome", "AUTHORITY_INVOCATION"],
    ] as const;
    for (const [table, key, value, mutableColumn, marker] of immutableRows) {
      await expectSqlFailure(`UPDATE "${table}" SET "${mutableColumn}" = "${mutableColumn}" WHERE "${key}" = ${quote(value)}`, `${marker}_IMMUTABLE`);
      await expectSqlFailure(`DELETE FROM "${table}" WHERE "${key}" = ${quote(value)}`, `${marker}_DELETE_FORBIDDEN`);
    }
  });

  it("freezes Actor rows after creation", async () => {
    await expectSqlFailure(`UPDATE "Actor" SET "category" = 'SYSTEM' WHERE "id" = 'actor-human'`, "ACTOR_IMMUTABLE");
    await expectSqlFailure(`DELETE FROM "Actor" WHERE "id" = 'actor-human'`, "ACTOR_DELETE_FORBIDDEN");
  });

  it("reapplies 0001 through 0012 as a no-op", () => {
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
