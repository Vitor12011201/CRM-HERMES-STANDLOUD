import type { LeadEvidenceInput } from "@/lib/services/lead-research";

/** Small structural D1 port: production uses the native binding; tests use a deterministic fake. */
export type ResearchApprovalPreparedStatement = {
  bind(...values: unknown[]): ResearchApprovalPreparedStatement;
};

export type ResearchApprovalD1Database = {
  prepare(query: string): ResearchApprovalPreparedStatement;
  batch(statements: ResearchApprovalPreparedStatement[]): Promise<Array<{ meta: { changes: number } }>>;
};

export type ResearchApprovalCommitInput = {
  runId: string;
  leadId: string;
  evidence: readonly LeadEvidenceInput[];
};

export type ResearchApprovalCommitResult = {
  /** True only when this batch moved the guarded run from APPROVING to APPROVED. */
  committed: boolean;
};

export type ResearchApprovalCommitter = {
  commit(input: ResearchApprovalCommitInput): Promise<ResearchApprovalCommitResult>;
};

export class ResearchApprovalCommitError extends Error {
  constructor(public readonly code: "ATOMIC_COMMIT_FAILED" | "ATOMIC_COMMIT_INVALID_RESULT") {
    super(code);
    this.name = "ResearchApprovalCommitError";
  }
}

type AtomicCommitOptions = {
  now?: () => Date;
  createEvidenceId?: () => string;
};

const insertEvidenceSql = `
INSERT INTO "LeadEvidence" (
  "id", "leadId", "sourceType", "sourceUrl", "observation",
  "observedAt", "createdAt", "updatedAt", "capturedBy"
)
SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
WHERE EXISTS (
  SELECT 1 FROM "LeadResearchRun"
  WHERE "id" = ? AND "leadId" = ? AND "status" = 'APPROVING'
)
AND NOT EXISTS (
  SELECT 1 FROM "LeadEvidence"
  WHERE "leadId" = ?
    AND "sourceType" = ?
    AND "sourceUrl" IS ?
    AND "observation" = ?
)
`;

const markApprovedSql = `
UPDATE "LeadResearchRun"
SET "status" = 'APPROVED', "reviewedAt" = ?, "updatedAt" = ?
WHERE "id" = ? AND "leadId" = ? AND "status" = 'APPROVING'
`;

function createEvidenceId(): string {
  if (typeof crypto?.randomUUID !== "function") {
    throw new ResearchApprovalCommitError("ATOMIC_COMMIT_FAILED");
  }
  // CUID-compatible lowercase ID shape; D1 raw SQL has no Prisma cuid() default.
  return `c${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * The frozen evidence boundary authorizes the factual batch; this adapter is
 * intentionally responsible only for its all-or-nothing D1 commit. D1 batch
 * executes every insert plus the terminal state update in one transaction.
 */
export function createD1ResearchApprovalCommitter(
  database: ResearchApprovalD1Database,
  options: AtomicCommitOptions = {},
): ResearchApprovalCommitter {
  const now = options.now ?? (() => new Date());
  const nextEvidenceId = options.createEvidenceId ?? createEvidenceId;

  return {
    async commit(input) {
      const timestamp = now().toISOString();
      let statements: ResearchApprovalPreparedStatement[];
      try {
        statements = input.evidence.map((evidence) => database.prepare(insertEvidenceSql).bind(
          nextEvidenceId(),
          input.leadId,
          evidence.sourceType,
          evidence.sourceUrl ?? null,
          evidence.observation,
          timestamp,
          timestamp,
          timestamp,
          "AGENT",
          input.runId,
          input.leadId,
          input.leadId,
          evidence.sourceType,
          evidence.sourceUrl ?? null,
          evidence.observation,
        ));
        statements.push(database.prepare(markApprovedSql).bind(
          timestamp,
          timestamp,
          input.runId,
          input.leadId,
        ));
      } catch (error) {
        if (error instanceof ResearchApprovalCommitError) throw error;
        throw new ResearchApprovalCommitError("ATOMIC_COMMIT_FAILED");
      }

      let results: Array<{ meta: { changes: number } }>;
      try {
        results = await database.batch(statements);
      } catch {
        // D1 batch failure rolls every statement back; do not compensate with deletes.
        throw new ResearchApprovalCommitError("ATOMIC_COMMIT_FAILED");
      }
      const terminalUpdate = results[results.length - 1];
      if (!terminalUpdate || typeof terminalUpdate.meta?.changes !== "number") {
        throw new ResearchApprovalCommitError("ATOMIC_COMMIT_INVALID_RESULT");
      }
      return { committed: terminalUpdate.meta.changes === 1 };
    },
  };
}
