import { z } from "zod";

import { LeadStatus } from "@/generated/prisma/enums";
import {
  assessScoutDuplicate,
  scoutDiscoveryCandidateSchema,
  scoutResultSchema,
  type ScoutDiscoveryCandidate,
  type ScoutDiscoverySource,
  type ScoutExistingLeadReference,
  type ScoutFoundResult,
  type ScoutResult,
} from "@/lib/scout/contracts";
import {
  createLead,
  listScoutExistingLeadReferences,
  type LeadCreateInput,
} from "@/lib/services/leads";
import { leadSchema } from "@/lib/validation";

const approvedScoutLeadCreationMarker = Symbol("approvedScoutLeadCreation");

export const scoutLeadHumanApprovalSchema = z.object({
  approved: z.literal(true),
  acknowledgeUnresolvedQuestions: z.literal(true).optional(),
}).strict();

export type ScoutLeadHumanApproval = z.infer<typeof scoutLeadHumanApprovalSchema>;

/** Facts that can become a Lead only after explicit human approval. */
export type CandidateLead = Readonly<Pick<
  LeadCreateInput,
  | "companyName"
  | "city"
  | "region"
  | "segment"
  | "websiteUrl"
  | "source"
  | "qualificationScore"
  | "status"
>>;

export type ApprovedScoutCandidate = Readonly<Omit<ScoutDiscoveryCandidate, "source">> & {
  readonly source: Readonly<ScoutDiscoverySource>;
};

/** Opaque approval output; only prepareApprovedScoutLeadCreation can mark it. */
export type ApprovedScoutLeadCreation = {
  readonly candidateLead: CandidateLead;
  readonly [approvedScoutLeadCreationMarker]: true;
  readonly scoutCandidate: ApprovedScoutCandidate;
};

export type ApprovedScoutLeadCreationStore = {
  listExistingLeadReferences(): Promise<readonly ScoutExistingLeadReference[]>;
  createLead(input: CandidateLead): Promise<unknown>;
};

export type PersistApprovedScoutLeadCreationResult = {
  candidateLead: CandidateLead;
  lead: unknown;
};

export class ScoutLeadApprovalError extends Error {
  constructor(
    public readonly code:
      | "SCOUT_RESULT_NOT_FOUND"
      | "INVALID_SCOUT_LEAD_APPROVAL"
      | "SCOUT_LEAD_CANDIDATE_INVALID"
      | "UNAPPROVED_SCOUT_LEAD_CREATION"
      | "SCOUT_LEAD_EXACT_DUPLICATE"
      | "SCOUT_LEAD_AMBIGUOUS_DUPLICATE",
  ) {
    super(code);
    this.name = "ScoutLeadApprovalError";
  }
}

function parseFoundScoutResult(result: ScoutResult): ScoutFoundResult {
  const parsed = scoutResultSchema.parse(result);
  if (parsed.outcome !== "FOUND") {
    throw new ScoutLeadApprovalError("SCOUT_RESULT_NOT_FOUND");
  }
  return parsed;
}

/** Maps only discovery facts and deterministic provenance into a zero-score Lead. */
export function toCandidateLead(result: ScoutFoundResult): CandidateLead {
  const candidate = result.candidate;
  return {
    companyName: candidate.companyName,
    ...(candidate.city === undefined ? {} : { city: candidate.city }),
    ...(candidate.region === undefined ? {} : { region: candidate.region }),
    ...(candidate.segment === undefined ? {} : { segment: candidate.segment }),
    ...(candidate.websiteUrl === undefined ? {} : { websiteUrl: candidate.websiteUrl }),
    source: `SCOUT:${candidate.source.type}:${candidate.discoveryId}`,
    qualificationScore: 0,
    status: LeadStatus.NEW,
  };
}

function freezeScoutCandidate(candidate: ScoutDiscoveryCandidate): ApprovedScoutCandidate {
  const snapshot = scoutDiscoveryCandidateSchema.parse({
    discoveryId: candidate.discoveryId,
    companyName: candidate.companyName,
    ...(candidate.city === undefined ? {} : { city: candidate.city }),
    ...(candidate.region === undefined ? {} : { region: candidate.region }),
    ...(candidate.segment === undefined ? {} : { segment: candidate.segment }),
    ...(candidate.websiteUrl === undefined ? {} : { websiteUrl: candidate.websiteUrl }),
    source: { ...candidate.source },
  });

  return Object.freeze({
    ...snapshot,
    source: Object.freeze({ ...snapshot.source }),
  });
}

function freezeCandidateLead(candidateLead: LeadCreateInput): CandidateLead {
  return Object.freeze({
    companyName: candidateLead.companyName,
    ...(candidateLead.city === undefined ? {} : { city: candidateLead.city }),
    ...(candidateLead.region === undefined ? {} : { region: candidateLead.region }),
    ...(candidateLead.segment === undefined ? {} : { segment: candidateLead.segment }),
    ...(candidateLead.websiteUrl === undefined ? {} : { websiteUrl: candidateLead.websiteUrl }),
    ...(candidateLead.source === undefined ? {} : { source: candidateLead.source }),
    qualificationScore: candidateLead.qualificationScore,
    status: candidateLead.status,
  });
}

/**
 * Converts a FOUND result into an opaque write authorization only after exact,
 * explicit human approval. A Scout result is never an approval by itself.
 */
export function prepareApprovedScoutLeadCreation(
  result: ScoutResult,
  approval: ScoutLeadHumanApproval,
): ApprovedScoutLeadCreation {
  const found = parseFoundScoutResult(result);
  const parsedApproval = scoutLeadHumanApprovalSchema.safeParse(approval);
  if (!parsedApproval.success) {
    throw new ScoutLeadApprovalError("INVALID_SCOUT_LEAD_APPROVAL");
  }
  if (
    found.unresolvedQuestions.length > 0
    && parsedApproval.data.acknowledgeUnresolvedQuestions !== true
  ) {
    throw new ScoutLeadApprovalError("INVALID_SCOUT_LEAD_APPROVAL");
  }

  const candidateLead = leadSchema.safeParse(toCandidateLead(found));
  if (!candidateLead.success) {
    throw new ScoutLeadApprovalError("SCOUT_LEAD_CANDIDATE_INVALID");
  }

  return Object.freeze({
    candidateLead: freezeCandidateLead(candidateLead.data),
    scoutCandidate: freezeScoutCandidate(found.candidate),
    [approvedScoutLeadCreationMarker]: true,
  });
}

function isApprovedScoutLeadCreation(value: unknown): value is ApprovedScoutLeadCreation {
  return typeof value === "object"
    && value !== null
    && (value as Partial<ApprovedScoutLeadCreation>)[approvedScoutLeadCreationMarker] === true;
}

export const liveScoutLeadCreationStore: ApprovedScoutLeadCreationStore = {
  listExistingLeadReferences: listScoutExistingLeadReferences,
  createLead,
};

/**
 * Rechecks CRM duplicate state immediately before the one permitted create.
 * Exact and ambiguous matches both fail closed; Scout owns the shared rule.
 */
export async function persistApprovedScoutLeadCreation(
  approved: ApprovedScoutLeadCreation,
  store: ApprovedScoutLeadCreationStore = liveScoutLeadCreationStore,
): Promise<PersistApprovedScoutLeadCreationResult> {
  if (!isApprovedScoutLeadCreation(approved)) {
    throw new ScoutLeadApprovalError("UNAPPROVED_SCOUT_LEAD_CREATION");
  }

  const existingReferences = await store.listExistingLeadReferences();
  const assessments = existingReferences.map((reference) =>
    assessScoutDuplicate(approved.scoutCandidate as ScoutDiscoveryCandidate, reference));

  if (assessments.includes("EXACT_DUPLICATE")) {
    throw new ScoutLeadApprovalError("SCOUT_LEAD_EXACT_DUPLICATE");
  }
  if (assessments.includes("AMBIGUOUS")) {
    throw new ScoutLeadApprovalError("SCOUT_LEAD_AMBIGUOUS_DUPLICATE");
  }

  const lead = await store.createLead(approved.candidateLead);
  return { candidateLead: approved.candidateLead, lead };
}
