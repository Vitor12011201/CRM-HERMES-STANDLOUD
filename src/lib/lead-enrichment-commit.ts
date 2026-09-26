/** Small structural port: production uses D1 while tests use deterministic fakes. */
export type LeadEnrichmentPreparedStatement = {
  bind(...values: unknown[]): LeadEnrichmentPreparedStatement;
};

export type LeadEnrichmentD1Database = {
  prepare(query: string): LeadEnrichmentPreparedStatement;
  batch(statements: LeadEnrichmentPreparedStatement[]): Promise<Array<{ meta: { changes: number } }>>;
};

export type LeadEnrichmentContactColumn = "email" | "phone" | "whatsapp";

export type LeadEnrichmentCommitInput = {
  leadId: string;
  expected: Partial<Record<LeadEnrichmentContactColumn, string | null>>;
  changes: Partial<Record<LeadEnrichmentContactColumn, string>>;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
};

export type LeadEnrichmentCommitResult = {
  /** True only when both the guarded Lead update and success audit were inserted. */
  committed: boolean;
};

export type LeadEnrichmentCommitter = {
  commit(input: LeadEnrichmentCommitInput): Promise<LeadEnrichmentCommitResult>;
};

export class LeadEnrichmentCommitError extends Error {
  constructor(public readonly code: "ATOMIC_COMMIT_FAILED" | "ATOMIC_COMMIT_INVALID_RESULT") {
    super(code);
    this.name = "LeadEnrichmentCommitError";
  }
}

type CommitOptions = {
  now?: () => Date;
  createAuditId?: () => string;
};

const allowedColumns = new Set<LeadEnrichmentContactColumn>(["email", "phone", "whatsapp"]);

function createAuditId(): string {
  if (typeof crypto?.randomUUID !== "function") {
    throw new LeadEnrichmentCommitError("ATOMIC_COMMIT_FAILED");
  }
  // Prisma's String IDs have no D1 SQL default; retain the project-compatible CUID shape.
  return `c${crypto.randomUUID().replaceAll("-", "")}`;
}

function assertCommitInput(input: LeadEnrichmentCommitInput) {
  const fields = Object.keys(input.changes) as LeadEnrichmentContactColumn[];
  if (fields.length === 0 || fields.some((field) => !allowedColumns.has(field) || input.changes[field] === undefined)) {
    throw new LeadEnrichmentCommitError("ATOMIC_COMMIT_INVALID_RESULT");
  }
  if (fields.some((field) => !(field in input.expected) || input.expected[field] === undefined)) {
    throw new LeadEnrichmentCommitError("ATOMIC_COMMIT_INVALID_RESULT");
  }
  return fields;
}

/**
 * Commits one guarded Lead mutation and its successful audit record together.
 * D1 batch is transactional: any statement failure rolls the entire attempt back.
 */
export function createD1LeadEnrichmentCommitter(
  database: LeadEnrichmentD1Database,
  options: CommitOptions = {},
): LeadEnrichmentCommitter {
  const now = options.now ?? (() => new Date());
  const nextAuditId = options.createAuditId ?? createAuditId;

  return {
    async commit(input) {
      const fields = assertCommitInput(input);
      const timestamp = now().toISOString();
      const assignments = fields.map((field) => `"${field}" = ?`);
      const guards = fields.map((field) => `"${field}" IS ?`);
      const updateSql = `
UPDATE "Lead"
SET ${[...assignments, '"updatedAt" = ?'].join(", ")}
WHERE "id" = ? AND ${guards.join(" AND ")}
`;
      const insertAuditSql = `
INSERT INTO "AgentAuditLog" (
  "id", "actor", "actorName", "toolName", "entityType", "entityId", "action",
  "beforeData", "afterData", "success", "errorMessage", "createdAt"
)
SELECT ?, 'AGENT', 'Ana', 'lead_enrichment', 'Lead', ?, 'APPLY_RESEARCH_ENRICHMENT', ?, ?, 1, NULL, ?
FROM "Lead"
WHERE "id" = ? AND "updatedAt" = ?
`;

      let statements: LeadEnrichmentPreparedStatement[];
      try {
        const updateValues = [
          ...fields.map((field) => input.changes[field]!),
          timestamp,
          input.leadId,
          ...fields.map((field) => input.expected[field]!),
        ];
        const auditValues = [
          nextAuditId(),
          input.leadId,
          JSON.stringify(input.beforeData),
          JSON.stringify(input.afterData),
          timestamp,
          input.leadId,
          timestamp,
        ];
        statements = [
          database.prepare(updateSql).bind(...updateValues),
          database.prepare(insertAuditSql).bind(...auditValues),
        ];
      } catch (error) {
        if (error instanceof LeadEnrichmentCommitError) throw error;
        throw new LeadEnrichmentCommitError("ATOMIC_COMMIT_FAILED");
      }

      let results: Array<{ meta: { changes: number } }>;
      try {
        results = await database.batch(statements);
      } catch {
        throw new LeadEnrichmentCommitError("ATOMIC_COMMIT_FAILED");
      }

      const [leadUpdate, auditInsert] = results;
      if (typeof leadUpdate?.meta?.changes !== "number" || typeof auditInsert?.meta?.changes !== "number") {
        throw new LeadEnrichmentCommitError("ATOMIC_COMMIT_INVALID_RESULT");
      }
      if (leadUpdate.meta.changes === 1 && auditInsert.meta.changes === 1) return { committed: true };
      if (leadUpdate.meta.changes === 0 && auditInsert.meta.changes === 0) return { committed: false };
      throw new LeadEnrichmentCommitError("ATOMIC_COMMIT_INVALID_RESULT");
    },
  };
}
