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
const migrationNames = [
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

const fixedTime = "2026-10-08T12:00:00.000Z";
const sha = (seed: string) => seed.repeat(64).slice(0, 64);

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function nullable(value: string | null) {
  return value === null ? "NULL" : quote(value);
}

function runWrangler(args: string[], cwd = repositoryRoot) {
  return execFileSync(process.execPath, [wranglerEntrypoint, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function migrationSql(name: string) {
  return join(migrationsDirectory, name);
}

function createLegacyConfig(directory: string) {
  return join(directory, "wrangler.jsonc");
}

function writeLegacyConfig(directory: string) {
  const configPath = createLegacyConfig(directory);
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "execution-run-d1-test",
      compatibility_date: "2026-10-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: databaseName,
          database_id: databaseId,
          migrations_dir: "migrations",
        },
      ],
    }),
  );
  return configPath;
}

type ExecutionRunInsert = {
  id: string;
  attemptKey: string;
  canonicalAttemptSha256?: string;
  executionRequestKey: string;
  attemptNumber?: number;
  retryOfExecutionRunId?: string | null;
  executorActorId?: string;
  authorityInvocationId?: string | null;
  authoritySubjectRefId?: string | null;
  capabilityKey?: string;
  contractVariantKey?: string | null;
  correlationKey?: string | null;
  status?: "STARTED" | "SUCCESS" | "FAILED";
  startedAt?: string;
  finishedAt?: string | null;
  failureCode?: string | null;
  diagnosticSummary?: string | null;
  diagnosticSha256?: string | null;
};

function executionRunInsert(input: ExecutionRunInsert) {
  const row = {
    canonicalAttemptSha256: sha("a"),
    attemptNumber: 1,
    retryOfExecutionRunId: null,
    executorActorId: "actor-executor",
    authorityInvocationId: null,
    authoritySubjectRefId: null,
    capabilityKey: "cap.unattested",
    contractVariantKey: null,
    correlationKey: null,
    status: "STARTED" as const,
    startedAt: fixedTime,
    finishedAt: null,
    failureCode: null,
    diagnosticSummary: null,
    diagnosticSha256: null,
    ...input,
  };

  return `INSERT INTO "ExecutionRun" (
    "id", "attemptKey", "canonicalAttemptSha256", "executionRequestKey", "attemptNumber",
    "retryOfExecutionRunId", "executorActorId", "authorityInvocationId", "authoritySubjectRefId",
    "capabilityKey", "contractVariantKey", "correlationKey", "status", "startedAt", "finishedAt",
    "failureCode", "diagnosticSummary", "diagnosticSha256", "createdAt"
  ) VALUES (
    ${quote(row.id)}, ${quote(row.attemptKey)}, ${quote(row.canonicalAttemptSha256)}, ${quote(row.executionRequestKey)}, ${row.attemptNumber},
    ${nullable(row.retryOfExecutionRunId)}, ${quote(row.executorActorId)}, ${nullable(row.authorityInvocationId)}, ${nullable(row.authoritySubjectRefId)},
    ${quote(row.capabilityKey)}, ${nullable(row.contractVariantKey)}, ${nullable(row.correlationKey)}, ${quote(row.status)}, ${quote(row.startedAt)}, ${nullable(row.finishedAt)},
    ${nullable(row.failureCode)}, ${nullable(row.diagnosticSummary)}, ${nullable(row.diagnosticSha256)}, ${quote(fixedTime)}
  )`;
}

describe("ExecutionRun D1 kernel", () => {
  let persistenceDirectory: string;
  let authorityFixtureSeeded = false;
  let executionChainSeeded = false;

  function d1ExecuteArgs(sql: string, json = false) {
    return [
      "d1",
      "execute",
      databaseName,
      "--local",
      "--persist-to",
      persistenceDirectory,
      "--config",
      join(repositoryRoot, "wrangler.jsonc"),
      "--command",
      sql,
      ...(json ? ["--json"] : []),
    ];
  }

  async function execute(sql: string) {
    runWrangler(d1ExecuteArgs(sql));
  }

  async function query<T>(sql: string) {
    const output = runWrangler(d1ExecuteArgs(sql, true));
    return {
      results: ((JSON.parse(output) as Array<{ results?: T[] }>)[0]?.results ?? []),
    };
  }

  async function scalar(sql: string) {
    const result = await query<{ value: number }>(sql);
    return result.results[0]?.value;
  }

  async function expectFailure(sql: string, marker?: string) {
    let error: unknown;
    try {
      await execute(sql);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    if (marker) {
      expect(String(error)).toContain(marker);
    }
  }

  async function seedAuthorityFixture() {
    if (authorityFixtureSeeded) return;
    await execute(`
      INSERT INTO "Actor" ("id", "category") VALUES
        ('actor-principal', 'HUMAN'),
        ('actor-executor', 'SYSTEM'),
        ('actor-other', 'SYSTEM');

      INSERT INTO "AuthorityBootstrapReceipt" (
        "bootstrapKey", "manifestVersion", "manifestSha256", "manifestSourceRef", "principalActorId", "provisionedAt"
      ) VALUES (
        'AUTHORITY_BOOTSTRAP_V1', 'authority-manifest/v1', '${sha("b")}', 'execution-run-d1-fixture', 'actor-principal', '${fixedTime}'
      );

      INSERT INTO "AuthoritySubjectRef" (
        "id", "registryVersion", "subjectType", "subjectId", "versionKind", "versionToken", "descriptorFormat", "canonicalKey", "descriptorSha256"
      ) VALUES
        ('subject-run', 'registry/v1', 'CASE', 'case-run', 'NON_VERSIONED', NULL, 'authority-subject/v1', 'subject:case-run', '${sha("c")}'),
        ('subject-other', 'registry/v1', 'CASE', 'case-other', 'NON_VERSIONED', NULL, 'authority-subject/v1', 'subject:case-other', '${sha("d")}');

      INSERT INTO "AuthorityPolicyVersion" (
        "id", "policyKey", "revision", "recordKind", "normativeActionKey", "authorityMode", "scopeSchemaKey", "scopeSchemaVersion", "definitionJson", "contentSha256", "priorDecisionDisposition", "bootstrapKey"
      ) VALUES (
        'policy-run', 'policy.execution.run', 1, 'POLICY', 'RUN_ACTION', 'POLICY_GOVERNED', 'scope.execution', 'v1', '{}', '${sha("e")}', 'PRESERVE', 'AUTHORITY_BOOTSTRAP_V1'
      );

      INSERT INTO "ExecutorEligibilityRuleSetVersion" (
        "id", "ruleSetKey", "revision", "recordKind", "contractCatalogRevision", "contentSha256", "bootstrapKey"
      ) VALUES (
        'rules-run', 'rules.execution.run', 1, 'RULESET', 'catalog/v1', '${sha("f")}', 'AUTHORITY_BOOTSTRAP_V1'
      );

      INSERT INTO "ExecutorEligibilityRule" (
        "id", "ruleSetVersionId", "capabilityKey", "contractVariantKey", "executorType", "verdict", "ruleSha256"
      ) VALUES (
        'rule-run', 'rules-run', 'cap.execution', 'DEFAULT', 'DETERMINISTIC_SYSTEM', 'ELIGIBLE', '${sha("1")}'
      );

      INSERT INTO "AuthorityInvocation" (
        "id", "invocationKey", "canonicalRequestSha256", "normativeActionKey", "capabilityKey", "contractVariantKey", "executorActorId", "executorType", "subjectRefId", "policyVersionId", "eligibilityRuleSetVersionId", "eligibilityRuleId", "outcome", "lineageSha256", "evaluatedAt"
      ) VALUES (
        'invocation-run', 'invoke:execution-run', '${sha("2")}', 'RUN_ACTION', 'cap.execution', NULL, 'actor-executor', 'DETERMINISTIC_SYSTEM', 'subject-run', 'policy-run', 'rules-run', 'rule-run', 'AUTHORIZED', '${sha("3")}', '${fixedTime}'
      );
    `);
    authorityFixtureSeeded = true;
  }

  async function seedExecutionChain() {
    if (executionChainSeeded) return;
    await seedAuthorityFixture();
    await execute(executionRunInsert({ id: "run-started", attemptKey: "attempt:started", executionRequestKey: "request:started" }));
    await execute(executionRunInsert({ id: "run-retry-1", attemptKey: "attempt:retry:1", executionRequestKey: "request:retry" }));
    await execute(
      executionRunInsert({
        id: "run-retry-2",
        attemptKey: "attempt:retry:2",
        executionRequestKey: "request:retry",
        attemptNumber: 2,
        retryOfExecutionRunId: "run-retry-1",
        executorActorId: "actor-other",
      }),
    );
    executionChainSeeded = true;
  }

  beforeAll(async () => {
    persistenceDirectory = mkdtempSync(join(tmpdir(), "execution-run-d1-"));
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

  afterAll(async () => {
    if (persistenceDirectory) {
      rmSync(persistenceDirectory, { recursive: true, force: true });
    }
  });

  it("keeps migration 0011 ExecutionRun structures intact in the current 0013 schema", async () => {
    expect(await scalar("SELECT COUNT(*) AS value FROM d1_migrations")).toBe(13);
    expect(await scalar("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'ExecutionRun'")).toBe(1);
    expect(
      await scalar(
        "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'index' AND name IN ('ExecutionRun_executionRequestKey_idx', 'ExecutionRun_status_startedAt_idx', 'ExecutionRun_executorActorId_startedAt_idx', 'ExecutionRun_authorityInvocationId_idx')",
      ),
    ).toBe(4);
    expect(
      await scalar(
        "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'trigger' AND name IN ('ExecutionRun_retry_chain_guard', 'ExecutionRun_authority_invocation_guard', 'ExecutionRun_update_guard', 'ExecutionRun_delete_forbidden')",
      ),
    ).toBe(4);
  }, 120_000);

  it("upgrades a legacy 0010 database once and reapplies 0011 idempotently", () => {
    const legacyDirectory = mkdtempSync(join(tmpdir(), "execution-run-legacy-"));
    const legacyMigrations = join(legacyDirectory, "migrations");
    mkdirSync(legacyMigrations);
    const configPath = writeLegacyConfig(legacyDirectory);

    try {
      for (const name of migrationNames.slice(0, -1)) {
        cpSync(migrationSql(name), join(legacyMigrations, name));
      }

      runWrangler(["d1", "migrations", "apply", databaseName, "--local", "--config", configPath], legacyDirectory);
      const legacyRows = (statement: string) => {
        const output = runWrangler(["d1", "execute", databaseName, "--local", "--config", configPath, "--command", statement, "--json"], legacyDirectory);
        return (JSON.parse(output) as Array<{ results?: Array<{ total: number }> }>)[0]?.results ?? [];
      };
      cpSync(migrationSql("0011_execution_run_kernel.sql"), join(legacyMigrations, "0011_execution_run_kernel.sql"));
      runWrangler(["d1", "migrations", "apply", databaseName, "--local", "--config", configPath], legacyDirectory);
      expect(Number(legacyRows("SELECT COUNT(*) AS total FROM d1_migrations")[0]?.total)).toBe(11);
      expect(Number(legacyRows("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'ExecutionRun'")[0]?.total)).toBe(1);
      expect(runWrangler(["d1", "migrations", "apply", databaseName, "--local", "--config", configPath], legacyDirectory)).toContain("No migrations to apply");
    } finally {
      rmSync(legacyDirectory, { recursive: true, force: true });
    }
  }, 120_000);

  it("accepts a valid STARTED attempt and a semantically consistent retry", async () => {
    await seedExecutionChain();
    expect(await scalar("SELECT COUNT(*) AS value FROM ExecutionRun WHERE executionRequestKey = 'request:retry'")).toBe(2);
  }, 120_000);

  it("rejects malformed identity, duplicate idempotency keys, and invalid retry chains", async () => {
    await seedExecutionChain();
    await expectFailure(
      executionRunInsert({ id: "run-bad-sha", attemptKey: "attempt:bad-sha", executionRequestKey: "request:bad-sha", canonicalAttemptSha256: "A".repeat(64) }),
    );
    await expectFailure(
      executionRunInsert({ id: "run-bad-first", attemptKey: "attempt:bad-first", executionRequestKey: "request:bad-first", retryOfExecutionRunId: "run-started" }),
    );
    await expectFailure(
      executionRunInsert({ id: "run-missing-parent", attemptKey: "attempt:missing-parent", executionRequestKey: "request:missing-parent", attemptNumber: 2, retryOfExecutionRunId: "no-such-run" }),
      "EXECUTION_RUN_RETRY_PARENT_MISMATCH",
    );
    await expectFailure(
      executionRunInsert({ id: "run-skip-retry", attemptKey: "attempt:skip-retry", executionRequestKey: "request:retry", attemptNumber: 3, retryOfExecutionRunId: "run-retry-1" }),
      "EXECUTION_RUN_RETRY_PARENT_MISMATCH",
    );
    await expectFailure(
      executionRunInsert({ id: "run-different-capability", attemptKey: "attempt:different-capability", executionRequestKey: "request:retry", attemptNumber: 3, retryOfExecutionRunId: "run-retry-2", capabilityKey: "cap.other" }),
      "EXECUTION_RUN_RETRY_PARENT_MISMATCH",
    );
    await expectFailure(executionRunInsert({ id: "run-duplicate-key", attemptKey: "attempt:started", executionRequestKey: "request:other" }));
    await expectFailure(executionRunInsert({ id: "run-fork", attemptKey: "attempt:fork", executionRequestKey: "request:retry", attemptNumber: 2, retryOfExecutionRunId: "run-retry-1" }));
  }, 120_000);

  it("requires an authority invocation to match the execution identity exactly", async () => {
    await seedAuthorityFixture();
    await execute(
      executionRunInsert({
        id: "run-authorized",
        attemptKey: "attempt:authorized",
        executionRequestKey: "request:authorized",
        executorActorId: "actor-executor",
        authorityInvocationId: "invocation-run",
        authoritySubjectRefId: "subject-run",
        capabilityKey: "cap.execution",
      }),
    );
    await expectFailure(
      executionRunInsert({
        id: "run-wrong-actor",
        attemptKey: "attempt:wrong-actor",
        executionRequestKey: "request:wrong-actor",
        executorActorId: "actor-other",
        authorityInvocationId: "invocation-run",
        authoritySubjectRefId: "subject-run",
        capabilityKey: "cap.execution",
      }),
      "EXECUTION_RUN_AUTHORITY_INVOCATION_MISMATCH",
    );
    await expectFailure(
      executionRunInsert({
        id: "run-wrong-subject",
        attemptKey: "attempt:wrong-subject",
        executionRequestKey: "request:wrong-subject",
        authorityInvocationId: "invocation-run",
        authoritySubjectRefId: "subject-other",
        capabilityKey: "cap.execution",
      }),
      "EXECUTION_RUN_AUTHORITY_INVOCATION_MISMATCH",
    );
    await expectFailure(
      executionRunInsert({
        id: "run-wrong-variant",
        attemptKey: "attempt:wrong-variant",
        executionRequestKey: "request:wrong-variant",
        authorityInvocationId: "invocation-run",
        authoritySubjectRefId: "subject-run",
        capabilityKey: "cap.execution",
        contractVariantKey: "PREMIUM",
      }),
      "EXECUTION_RUN_AUTHORITY_INVOCATION_MISMATCH",
    );
  }, 120_000);

  it("enforces STARTED to terminal lifecycle, immutable identity, diagnostics, and delete guard", async () => {
    await seedAuthorityFixture();
    if (!executionChainSeeded) {
      await execute(executionRunInsert({ id: "run-started", attemptKey: "attempt:started", executionRequestKey: "request:started" }));
    }
    await execute(executionRunInsert({ id: "run-success", attemptKey: "attempt:success", executionRequestKey: "request:success" }));
    await execute("UPDATE ExecutionRun SET status = 'SUCCESS', finishedAt = '2026-10-08T12:01:00.000Z' WHERE id = 'run-success'");
    expect(await scalar("SELECT COUNT(*) AS value FROM ExecutionRun WHERE id = 'run-success' AND status = 'SUCCESS'")).toBe(1);

    await execute(executionRunInsert({ id: "run-failed", attemptKey: "attempt:failed", executionRequestKey: "request:failed" }));
    await execute(
      `UPDATE ExecutionRun SET status = 'FAILED', finishedAt = '2026-10-08T12:01:00.000Z', failureCode = 'NETWORK_TIMEOUT', diagnosticSummary = 'safe diagnostic', diagnosticSha256 = '${sha("4")}' WHERE id = 'run-failed'`,
    );
    expect(await scalar("SELECT COUNT(*) AS value FROM ExecutionRun WHERE id = 'run-failed' AND status = 'FAILED'")).toBe(1);

    await expectFailure("UPDATE ExecutionRun SET correlationKey = 'mutated' WHERE id = 'run-success'", "EXECUTION_RUN_TERMINAL_IMMUTABLE");
    await expectFailure("UPDATE ExecutionRun SET capabilityKey = 'cap.changed' WHERE id = 'run-started'", "EXECUTION_RUN_IDENTITY_IMMUTABLE");
    await expectFailure("DELETE FROM ExecutionRun WHERE id = 'run-started'", "EXECUTION_RUN_DELETE_FORBIDDEN");
    await expectFailure(
      executionRunInsert({
        id: "run-bad-diagnostic",
        attemptKey: "attempt:bad-diagnostic",
        executionRequestKey: "request:bad-diagnostic",
        status: "FAILED",
        finishedAt: "2026-10-08T12:01:00.000Z",
        failureCode: "bad-code",
      }),
    );
    await expectFailure(
      executionRunInsert({
        id: "run-too-long-diagnostic",
        attemptKey: "attempt:too-long-diagnostic",
        executionRequestKey: "request:too-long-diagnostic",
        status: "FAILED",
        finishedAt: "2026-10-08T12:01:00.000Z",
        failureCode: "SAFE_FAILURE",
        diagnosticSummary: "x".repeat(2049),
        diagnosticSha256: sha("5"),
      }),
    );
  }, 120_000);

  it("keeps WorkflowEvent and deferred cost extensions absent while ExecutionRun statuses never create CostEntry", async () => {
    expect(await scalar("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'WorkflowEvent'"))
      .toBe(0);
    expect(await scalar("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'CostEntry'"))
      .toBe(1);
    expect(await scalar("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name IN ('CostEntryAttribution', 'CostReconciliation')"))
      .toBe(0);
    expect(await scalar("SELECT COUNT(*) AS value FROM CostEntry")).toBe(0);
  }, 120_000);

  it("reapplying active migrations through 0013 is a no-op", () => {
    expect(
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
      ]),
    ).toContain("No migrations to apply");
  }, 120_000);
});
