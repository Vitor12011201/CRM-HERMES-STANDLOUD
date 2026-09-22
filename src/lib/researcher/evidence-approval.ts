import { z } from "zod";

import type { LeadEvidenceInput } from "@/lib/services/lead-research";

import {
  researcherResultSchema,
  toLeadEvidenceInputs,
  type ResearcherEvidence,
  type ResearcherResult,
} from "./contracts";

const approvalBatchMarker = Symbol("approvedResearchEvidenceBatch");

const approvedEvidenceIndexesSchema = z.array(z.number().int().nonnegative())
  .superRefine((indexes, context) => {
    const seen = new Set<number>();
    indexes.forEach((index, position) => {
      if (seen.has(index)) {
        context.addIssue({
          code: "custom",
          path: [position],
          message: "Cada evidência só pode ser aprovada uma vez.",
        });
      }
      seen.add(index);
    });
  });

export const researchEvidenceApprovalSchema = z.object({
  leadId: z.string().trim().min(1).max(64),
  approvedEvidenceIndexes: approvedEvidenceIndexesSchema,
}).strict();

export type ResearchEvidenceApproval = z.infer<typeof researchEvidenceApprovalSchema>;

export type CandidateResearchEvidence = {
  index: number;
  evidence: ResearcherEvidence;
};

export type ApprovedResearchEvidenceBatch = {
  leadId: string;
  approvedEvidenceIndexes: readonly number[];
  evidence: readonly LeadEvidenceInput[];
  readonly [approvalBatchMarker]: true;
};

export type ExactStoredLeadEvidence = Pick<
  LeadEvidenceInput,
  "sourceType" | "sourceUrl" | "observation"
>;

/**
 * This port is intentionally the only persistence boundary. Its caller must
 * provide an ApprovedResearchEvidenceBatch created from explicit human input.
 */
export type ApprovedResearchEvidenceStore = {
  listEvidenceForLead(leadId: string): Promise<readonly ExactStoredLeadEvidence[]>;
  createEvidence(
    leadId: string,
    input: LeadEvidenceInput,
    options: { capturedBy: "AGENT" },
  ): Promise<unknown>;
};

export type PersistApprovedResearchEvidenceResult = {
  created: readonly LeadEvidenceInput[];
  skippedExactDuplicates: readonly LeadEvidenceInput[];
};

export class ResearchEvidenceApprovalError extends Error {
  constructor(
    public readonly code:
      | "INVALID_APPROVAL"
      | "APPROVED_INDEX_OUT_OF_RANGE"
      | "UNAPPROVED_BATCH",
  ) {
    super(code);
    this.name = "ResearchEvidenceApprovalError";
  }
}

function parseResearcherResult(result: ResearcherResult): ResearcherResult {
  return researcherResultSchema.parse(result);
}

function parseApprovedIndexes(indexes: readonly number[]): number[] {
  const parsed = approvedEvidenceIndexesSchema.safeParse(indexes);
  if (!parsed.success) throw new ResearchEvidenceApprovalError("INVALID_APPROVAL");
  return [...parsed.data].sort((left, right) => left - right);
}

function exactEvidenceKey(leadId: string, evidence: ExactStoredLeadEvidence): string {
  return JSON.stringify([
    leadId,
    evidence.sourceType,
    evidence.sourceUrl ?? null,
    evidence.observation,
  ]);
}

/** Creates stable, result-local candidate identities without authorizing writes. */
export function toCandidateResearchEvidence(result: ResearcherResult): CandidateResearchEvidence[] {
  const parsed = parseResearcherResult(result);
  return parsed.evidence.map((evidence, index) => ({ index, evidence }));
}

/**
 * Pure explicit selection. Researcher output is never itself write
 * authorization: every selected index must occur in the validated result.
 */
export function selectApprovedResearchEvidence(
  result: ResearcherResult,
  approvedEvidenceIndexes: readonly number[],
): CandidateResearchEvidence[] {
  const candidates = toCandidateResearchEvidence(result);
  const indexes = parseApprovedIndexes(approvedEvidenceIndexes);

  if (indexes.some((index) => index >= candidates.length)) {
    throw new ResearchEvidenceApprovalError("APPROVED_INDEX_OUT_OF_RANGE");
  }

  return indexes.map((index) => candidates[index]);
}

/**
 * Produces an opaque batch only after trusted code has supplied explicit human
 * approval. unresolvedQuestions and research confidence are intentionally not
 * included in LeadEvidence inputs.
 */
export function prepareApprovedResearchEvidence(
  result: ResearcherResult,
  approval: ResearchEvidenceApproval,
): ApprovedResearchEvidenceBatch {
  const parsedApproval = researchEvidenceApprovalSchema.safeParse(approval);
  if (!parsedApproval.success) throw new ResearchEvidenceApprovalError("INVALID_APPROVAL");

  const parsedResult = parseResearcherResult(result);
  const selected = selectApprovedResearchEvidence(
    parsedResult,
    parsedApproval.data.approvedEvidenceIndexes,
  );
  const evidence = toLeadEvidenceInputs({
    ...parsedResult,
    evidence: selected.map(({ evidence: candidate }) => candidate),
  });

  return {
    leadId: parsedApproval.data.leadId,
    approvedEvidenceIndexes: selected.map(({ index }) => index),
    evidence,
    [approvalBatchMarker]: true,
  };
}

function isApprovedBatch(value: unknown): value is ApprovedResearchEvidenceBatch {
  return typeof value === "object"
    && value !== null
    && (value as Partial<ApprovedResearchEvidenceBatch>)[approvalBatchMarker] === true;
}

/**
 * Persists only an opaque batch made by prepareApprovedResearchEvidence().
 * Exact duplicates are skipped deterministically by leadId + factual fields.
 * Creates are sequential: a store failure is propagated and may leave prior
 * successful creates intact; this function never reports partial success.
 */
export async function persistApprovedResearchEvidence(
  batch: ApprovedResearchEvidenceBatch,
  store: ApprovedResearchEvidenceStore,
): Promise<PersistApprovedResearchEvidenceResult> {
  if (!isApprovedBatch(batch)) throw new ResearchEvidenceApprovalError("UNAPPROVED_BATCH");

  const existing = await store.listEvidenceForLead(batch.leadId);
  const seen = new Set(existing.map((evidence) => exactEvidenceKey(batch.leadId, evidence)));
  const created: LeadEvidenceInput[] = [];
  const skippedExactDuplicates: LeadEvidenceInput[] = [];

  for (const evidence of batch.evidence) {
    const key = exactEvidenceKey(batch.leadId, evidence);
    if (seen.has(key)) {
      skippedExactDuplicates.push(evidence);
      continue;
    }

    await store.createEvidence(batch.leadId, evidence, { capturedBy: "AGENT" });
    seen.add(key);
    created.push(evidence);
  }

  return { created, skippedExactDuplicates };
}
