import { describe, expect, it, vi } from "vitest";

import {
  createD1ResearchApprovalCommitter,
  ResearchApprovalCommitError,
  type ResearchApprovalD1Database,
  type ResearchApprovalPreparedStatement,
} from "./research-workflow-approval-commit";

type CapturedStatement = { query: string; values: unknown[] };

function createD1Fake(results: Array<{ meta: { changes: number } }> = []) {
  const captured: CapturedStatement[] = [];
  const database: ResearchApprovalD1Database = {
    prepare: vi.fn((query: string) => {
      const capturedStatement: CapturedStatement = { query, values: [] };
      captured.push(capturedStatement);
      const statement: ResearchApprovalPreparedStatement = {
        bind(...values) {
          capturedStatement.values = values;
          return statement;
        },
      };
      return statement;
    }),
    batch: vi.fn().mockResolvedValue(results),
  };
  return { database, captured };
}

const approvalInput = {
  runId: "run-1",
  leadId: "lead-1",
  evidence: [
    { sourceType: "WEBSITE" as const, sourceUrl: "https://empresa.example.test", observation: "Observação um." },
    { sourceType: "WEBSITE" as const, observation: "Observação dois." },
  ],
};

describe("D1 atomic research approval committer", () => {
  it("submits every guarded exact-dedupe insert and terminal APPROVED update in one D1 batch", async () => {
    const { database, captured } = createD1Fake([{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }]);
    const committer = createD1ResearchApprovalCommitter(database, {
      now: () => new Date("2026-09-24T12:00:00.000Z"),
      createEvidenceId: (() => {
        let sequence = 0;
        return () => `cfixture${++sequence}`;
      })(),
    });

    await expect(committer.commit(approvalInput)).resolves.toEqual({ committed: true });

    expect(database.batch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(database.batch).mock.calls[0]?.[0]).toHaveLength(3);
    expect(captured[0]?.query).toContain('WHERE "id" = ? AND "leadId" = ? AND "status" = \'APPROVING\'');
    expect(captured[0]?.query).toContain('"sourceUrl" IS ?');
    expect(captured[0]?.values).toContain("AGENT");
    expect(captured[1]?.values).toContain(null);
    expect(captured[2]?.query).toContain("SET \"status\" = 'APPROVED'");
  });

  it("returns uncommitted when the guarded terminal update loses to a concurrent successful batch", async () => {
    const { database } = createD1Fake([{ meta: { changes: 0 } }, { meta: { changes: 0 } }, { meta: { changes: 0 } }]);
    const committer = createD1ResearchApprovalCommitter(database, { createEvidenceId: () => "cfixture" });

    await expect(committer.commit(approvalInput)).resolves.toEqual({ committed: false });
  });

  it("surfaces a sanitized atomic failure when D1 rejects the batch without attempting compensation", async () => {
    const { database } = createD1Fake();
    vi.mocked(database.batch).mockRejectedValueOnce(new Error("sqlite constraint"));
    const committer = createD1ResearchApprovalCommitter(database, { createEvidenceId: () => "cfixture" });

    await expect(committer.commit(approvalInput)).rejects.toMatchObject({
      name: ResearchApprovalCommitError.name,
      code: "ATOMIC_COMMIT_FAILED",
    });
    expect(database.batch).toHaveBeenCalledTimes(1);
  });
});
