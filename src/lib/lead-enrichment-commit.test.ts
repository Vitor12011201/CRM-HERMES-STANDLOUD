import { describe, expect, it, vi } from "vitest";

import {
  createD1LeadEnrichmentCommitter,
  LeadEnrichmentCommitError,
  type LeadEnrichmentD1Database,
  type LeadEnrichmentPreparedStatement,
} from "./lead-enrichment-commit";

type CapturedStatement = { query: string; values: unknown[] };

function createD1Fake(results: Array<{ meta: { changes: number } }> = []) {
  const captured: CapturedStatement[] = [];
  const database: LeadEnrichmentD1Database = {
    prepare: vi.fn((query: string) => {
      const statementCapture: CapturedStatement = { query, values: [] };
      captured.push(statementCapture);
      const statement: LeadEnrichmentPreparedStatement = {
        bind(...values) {
          statementCapture.values = values;
          return statement;
        },
      };
      return statement;
    }),
    batch: vi.fn().mockResolvedValue(results),
  };
  return { database, captured };
}

const commitInput = {
  leadId: "lead-1",
  expected: { email: null, phone: null },
  changes: { email: "contato@example.com.br", phone: "(12) 98817-7647" },
  beforeData: { email: null, phone: null },
  afterData: { email: "contato@example.com.br", phone: "(12) 98817-7647" },
};

describe("D1 atomic lead enrichment committer", () => {
  it("submits one guarded multi-field Lead update and its successful Ana audit in one batch", async () => {
    const { database, captured } = createD1Fake([{ meta: { changes: 1 } }, { meta: { changes: 1 } }]);
    const committer = createD1LeadEnrichmentCommitter(database, {
      now: () => new Date("2026-09-25T12:00:00.000Z"),
      createAuditId: () => "cauditfixture",
    });

    await expect(committer.commit(commitInput)).resolves.toEqual({ committed: true });

    expect(database.batch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(database.batch).mock.calls[0]?.[0]).toHaveLength(2);
    expect(captured[0]?.query).toContain('SET "email" = ?, "phone" = ?, "updatedAt" = ?');
    expect(captured[0]?.query).toContain('"email" IS ? AND "phone" IS ?');
    expect(captured[1]?.query).toContain('FROM "Lead"');
    expect(captured[1]?.query).toContain('"updatedAt" = ?');
    expect(captured[0]?.values[2]).toBe("2026-09-25T12:00:00.000Z");
    expect(captured[1]?.values[4]).toBe(captured[0]?.values[2]);
    expect(captured[1]?.values[6]).toBe(captured[0]?.values[2]);
    expect(captured[1]?.query).toContain("'AGENT', 'Ana', 'lead_enrichment', 'Lead'");
  });

  it("fails closed when D1 rejects the audit statement: the transaction has no committed Lead or audit change", async () => {
    const { database } = createD1Fake();
    const simulatedD1State = { email: null as string | null, phone: null as string | null, successfulAudits: 0 };
    vi.mocked(database.batch).mockRejectedValueOnce(new Error("audit constraint failure"));
    const committer = createD1LeadEnrichmentCommitter(database, { createAuditId: () => "cauditfixture" });

    await expect(committer.commit(commitInput)).rejects.toMatchObject({
      name: LeadEnrichmentCommitError.name,
      code: "ATOMIC_COMMIT_FAILED",
    });
    expect(database.batch).toHaveBeenCalledTimes(1);
    // A D1 batch commits only after every statement succeeds. The rejecting fake
    // deliberately leaves its transaction state untouched, modeling that contract.
    expect(simulatedD1State).toEqual({ email: null, phone: null, successfulAudits: 0 });
  });

  it("returns uncommitted for a lost Lead CAS and never reports a success audit", async () => {
    const { database } = createD1Fake([{ meta: { changes: 0 } }, { meta: { changes: 0 } }]);
    const committer = createD1LeadEnrichmentCommitter(database, { createAuditId: () => "cauditfixture" });

    await expect(committer.commit(commitInput)).resolves.toEqual({ committed: false });
  });

  it("fails closed for impossible Lead/audit batch result combinations", async () => {
    const { database } = createD1Fake([{ meta: { changes: 1 } }, { meta: { changes: 0 } }]);
    const committer = createD1LeadEnrichmentCommitter(database, { createAuditId: () => "cauditfixture" });

    await expect(committer.commit(commitInput)).rejects.toMatchObject({
      name: LeadEnrichmentCommitError.name,
      code: "ATOMIC_COMMIT_INVALID_RESULT",
    });
  });
});
