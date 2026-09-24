import { z } from "zod";

import {
  FoursquareScoutDiscoveryProvider,
} from "@/lib/scout/foursquare-discovery-provider";
import {
  discoverScoutCandidates,
  type ScoutDiscoveryProvider,
} from "@/lib/scout/discovery-provider";
import {
  runScoutDeterministicSelection,
  type ScoutDiscoveryCandidate,
  type ScoutExistingLeadReference,
  type ScoutFoundResult,
  type ScoutNoneResult,
  type ScoutResult,
} from "@/lib/scout/contracts";
import {
  ScoutLeadApprovalError,
  persistApprovedScoutLeadCreation,
  prepareApprovedScoutLeadCreation,
  type ApprovedScoutLeadCreation,
  type PersistApprovedScoutLeadCreationResult,
} from "@/lib/scout-lead-approval";
import {
  claimScoutCandidateReviewForApproval,
  findLeadByScoutProvenance,
  getScoutCandidateReview,
  listSeenScoutDiscoveryIdentities,
  markScoutCandidateReviewConverted,
  persistScoutCandidateReview,
  rejectScoutCandidateReview,
  releaseScoutCandidateReviewApprovalClaim,
  toScoutFoundResult,
  type PersistScoutCandidateReviewResult,
  type ScoutCandidateReviewApprovalClaimResult,
  type ScoutCandidateReview,
  type ScoutCandidateReviewTransitionResult,
} from "@/lib/scout-candidate-review";
import {
  ScoutExistingLeadReferenceReadError,
  listScoutExistingLeadReferences,
} from "@/lib/services/leads";

const requiredText = (maximumLength: number) => z.string().trim().min(1).max(maximumLength);

/** The only discovery controls accepted from the operational browser form. */
export const scoutWorkflowDiscoveryInputSchema = z.object({
  city: requiredText(160),
  region: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    requiredText(160).optional(),
  ),
  segment: requiredText(160),
  requirePublicWebsite: z.boolean(),
  limit: z.number().int().min(1).max(50),
}).strict();

export const scoutWorkflowApprovalInputSchema = z.object({
  acknowledgeUnresolvedQuestions: z.literal(true).optional(),
}).strict();

const reviewIdSchema = requiredText(64);
const leadIdResultSchema = z.object({ id: requiredText(64) }).passthrough();

export type ScoutWorkflowDiscoveryInput = z.infer<typeof scoutWorkflowDiscoveryInputSchema>;
export type ScoutWorkflowApprovalInput = z.infer<typeof scoutWorkflowApprovalInputSchema>;

export type ScoutWorkflowDiscoveryOutcome =
  | Readonly<{ outcome: "FOUND"; review: ScoutCandidateReview }>
  | Readonly<{ outcome: "NONE"; reason: ScoutNoneResult["reason"] | "NO_NEW_CANDIDATE" }>;

export type ScoutWorkflowApprovalOutcome = Readonly<{
  outcome: "CONVERTED";
  leadId: string;
  reconciled?: true;
}>;

export type ScoutWorkflowDependencies = {
  provider: ScoutDiscoveryProvider;
  discoverCandidates(
    provider: ScoutDiscoveryProvider,
    request: { targetLocations: Array<{ city: string; region?: string }>; targetSegments: string[]; limit: number },
  ): Promise<ScoutDiscoveryCandidate[]>;
  listSeenIdentities(): Promise<Array<{ sourceType: ScoutDiscoveryCandidate["source"]["type"]; discoveryId: string }>>;
  listExistingLeadReferences(): Promise<readonly ScoutExistingLeadReference[]>;
  select(input: {
    criteria: {
      targetLocations: string[];
      targetSegments: string[];
      requirePublicWebsite: boolean;
      maxCandidatesToInspect: number;
    };
    discoveryCandidates: ScoutDiscoveryCandidate[];
    existingLeadReferences: ScoutExistingLeadReference[];
  }): ScoutResult;
  persistReview(result: ScoutResult): Promise<PersistScoutCandidateReviewResult>;
  getReview(id: string): Promise<ScoutCandidateReview>;
  claimReview(id: string): Promise<ScoutCandidateReviewApprovalClaimResult>;
  releaseReview(id: string): Promise<ScoutCandidateReviewTransitionResult>;
  markConverted(id: string, leadId: string): Promise<ScoutCandidateReviewTransitionResult>;
  rejectReview(id: string): Promise<ScoutCandidateReviewTransitionResult>;
  findLeadByProvenance(
    sourceType: ScoutCandidateReview["source"]["type"],
    discoveryId: string,
  ): Promise<{ id: string } | null>;
  prepareLead(result: ScoutResult, input: { approved: true; acknowledgeUnresolvedQuestions?: true }): ApprovedScoutLeadCreation;
  persistLead(approved: ApprovedScoutLeadCreation): Promise<PersistApprovedScoutLeadCreationResult>;
};

export class ScoutWorkflowError extends Error {
  constructor(
    public readonly code:
      | "SCOUT_WORKFLOW_DISCOVERY_INPUT_INVALID"
      | "SCOUT_WORKFLOW_DISCOVERY_FAILED"
      | "SCOUT_APPROVAL_INPUT_INVALID"
      | "SCOUT_APPROVAL_RETRYABLE"
      | "SCOUT_APPROVAL_IN_PROGRESS"
      | "SCOUT_APPROVAL_RECONCILIATION_PENDING"
      | "SCOUT_APPROVAL_INVALID_STATE"
      | "SCOUT_APPROVAL_DUPLICATE_CONFLICT",
  ) {
    super(code);
    this.name = "ScoutWorkflowError";
  }
}

function liveDependencies(): ScoutWorkflowDependencies {
  return {
    provider: new FoursquareScoutDiscoveryProvider(),
    discoverCandidates: discoverScoutCandidates,
    listSeenIdentities: listSeenScoutDiscoveryIdentities,
    listExistingLeadReferences: listScoutExistingLeadReferences,
    select: runScoutDeterministicSelection,
    persistReview: persistScoutCandidateReview,
    getReview: getScoutCandidateReview,
    claimReview: claimScoutCandidateReviewForApproval,
    releaseReview: releaseScoutCandidateReviewApprovalClaim,
    markConverted: markScoutCandidateReviewConverted,
    rejectReview: rejectScoutCandidateReview,
    findLeadByProvenance: findLeadByScoutProvenance,
    prepareLead: prepareApprovedScoutLeadCreation,
    persistLead: persistApprovedScoutLeadCreation,
  };
}

function seenIdentityKey(sourceType: string, discoveryId: string): string {
  return `${sourceType}\u0000${discoveryId}`;
}

function parseDiscoveryInput(input: unknown): ScoutWorkflowDiscoveryInput {
  const parsed = scoutWorkflowDiscoveryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ScoutWorkflowError("SCOUT_WORKFLOW_DISCOVERY_INPUT_INVALID");
  }
  return parsed.data;
}

function parseApprovalInput(input: unknown): ScoutWorkflowApprovalInput {
  const parsed = scoutWorkflowApprovalInputSchema.safeParse(input);
  if (!parsed.success) throw new ScoutWorkflowError("SCOUT_APPROVAL_INPUT_INVALID");
  return parsed.data;
}

function parseReviewId(id: string): string {
  const parsed = reviewIdSchema.safeParse(id);
  if (!parsed.success) throw new ScoutWorkflowError("SCOUT_APPROVAL_INPUT_INVALID");
  return parsed.data;
}

function provenNoWriteLeadFailure(error: unknown): "DUPLICATE" | "RETRYABLE" | undefined {
  if (error instanceof ScoutExistingLeadReferenceReadError) return "RETRYABLE";
  if (!(error instanceof ScoutLeadApprovalError)) return undefined;
  if (error.code === "SCOUT_LEAD_EXACT_DUPLICATE" || error.code === "SCOUT_LEAD_AMBIGUOUS_DUPLICATE") {
    return "DUPLICATE";
  }
  return undefined;
}

function convertedOutcome(leadId: string, reconciled?: true): ScoutWorkflowApprovalOutcome {
  return reconciled === true
    ? { outcome: "CONVERTED", leadId, reconciled: true }
    : { outcome: "CONVERTED", leadId };
}

async function reconcileApproval(
  review: ScoutCandidateReview,
  dependencies: ScoutWorkflowDependencies,
): Promise<ScoutWorkflowApprovalOutcome> {
  let existingLead: { id: string } | null;
  try {
    existingLead = await dependencies.findLeadByProvenance(review.source.type, review.discoveryId);
  } catch {
    throw new ScoutWorkflowError("SCOUT_APPROVAL_RECONCILIATION_PENDING");
  }

  if (existingLead === null) {
    throw new ScoutWorkflowError("SCOUT_APPROVAL_IN_PROGRESS");
  }

  try {
    await dependencies.markConverted(review.id, existingLead.id);
  } catch {
    throw new ScoutWorkflowError("SCOUT_APPROVAL_RECONCILIATION_PENDING");
  }
  return convertedOutcome(existingLead.id, true);
}

async function releaseProvenNoWriteClaim(
  reviewId: string,
  code: "SCOUT_APPROVAL_DUPLICATE_CONFLICT" | "SCOUT_APPROVAL_RETRYABLE",
  dependencies: ScoutWorkflowDependencies,
): Promise<never> {
  try {
    await dependencies.releaseReview(reviewId);
  } catch {
    throw new ScoutWorkflowError("SCOUT_APPROVAL_RECONCILIATION_PENDING");
  }
  throw new ScoutWorkflowError(code);
}

/**
 * Composes source discovery, exact seen-identity filtering, frozen Scout
 * selection, and persistent human-review storage. It never accepts a browser
 * candidate or source payload.
 */
export async function discoverScoutCandidateForReview(
  input: unknown,
  dependencies: ScoutWorkflowDependencies = liveDependencies(),
): Promise<ScoutWorkflowDiscoveryOutcome> {
  const parsed = parseDiscoveryInput(input);
  let discovered: ScoutDiscoveryCandidate[];
  try {
    discovered = await dependencies.discoverCandidates(dependencies.provider, {
      targetLocations: [{ city: parsed.city, ...(parsed.region === undefined ? {} : { region: parsed.region }) }],
      targetSegments: [parsed.segment],
      limit: parsed.limit,
    });
  } catch {
    throw new ScoutWorkflowError("SCOUT_WORKFLOW_DISCOVERY_FAILED");
  }

  let seen: Array<{ sourceType: ScoutDiscoveryCandidate["source"]["type"]; discoveryId: string }>;
  try {
    seen = await dependencies.listSeenIdentities();
  } catch {
    throw new ScoutWorkflowError("SCOUT_WORKFLOW_DISCOVERY_FAILED");
  }
  const seenKeys = new Set(seen.map((identity) => seenIdentityKey(identity.sourceType, identity.discoveryId)));
  const unseen = discovered.filter((candidate) =>
    !seenKeys.has(seenIdentityKey(candidate.source.type, candidate.discoveryId)));

  if (unseen.length === 0) return { outcome: "NONE", reason: "NO_NEW_CANDIDATE" };

  let existingLeadReferences: readonly ScoutExistingLeadReference[];
  try {
    existingLeadReferences = await dependencies.listExistingLeadReferences();
  } catch {
    throw new ScoutWorkflowError("SCOUT_WORKFLOW_DISCOVERY_FAILED");
  }

  let result: ScoutResult;
  try {
    result = dependencies.select({
      criteria: {
        targetLocations: [parsed.city, ...(parsed.region === undefined ? [] : [parsed.region])],
        targetSegments: [parsed.segment],
        requirePublicWebsite: parsed.requirePublicWebsite,
        maxCandidatesToInspect: Math.min(parsed.limit, unseen.length),
      },
      discoveryCandidates: unseen,
      existingLeadReferences: [...existingLeadReferences],
    });
  } catch {
    throw new ScoutWorkflowError("SCOUT_WORKFLOW_DISCOVERY_FAILED");
  }

  if (result.outcome === "NONE") return { outcome: "NONE", reason: result.reason };

  try {
    const persisted = await dependencies.persistReview(result);
    return { outcome: "FOUND", review: persisted.review };
  } catch {
    throw new ScoutWorkflowError("SCOUT_WORKFLOW_DISCOVERY_FAILED");
  }
}

/**
 * Runs the sole owner/retry approval paths. A retry that did not win the claim
 * performs provenance reconciliation only and is never allowed to create a Lead.
 */
export async function approveScoutCandidateReview(
  id: string,
  input: unknown,
  dependencies: ScoutWorkflowDependencies = liveDependencies(),
): Promise<ScoutWorkflowApprovalOutcome> {
  const reviewId = parseReviewId(id);
  const approval = parseApprovalInput(input);
  let review: ScoutCandidateReview;
  try {
    review = await dependencies.getReview(reviewId);
  } catch {
    throw new ScoutWorkflowError("SCOUT_APPROVAL_INVALID_STATE");
  }

  if (review.status === "CONVERTED" && review.leadId !== undefined) {
    return convertedOutcome(review.leadId, true);
  }
  if (review.status === "REJECTED") {
    throw new ScoutWorkflowError("SCOUT_APPROVAL_INVALID_STATE");
  }
  if (review.status === "APPROVING") {
    return reconcileApproval(review, dependencies);
  }

  let approved: ApprovedScoutLeadCreation;
  try {
    const found: ScoutFoundResult = toScoutFoundResult(review);
    approved = dependencies.prepareLead(found, {
      approved: true,
      ...(approval.acknowledgeUnresolvedQuestions === true
        ? { acknowledgeUnresolvedQuestions: true }
        : {}),
    });
  } catch {
    throw new ScoutWorkflowError("SCOUT_APPROVAL_INPUT_INVALID");
  }

  let claim: ScoutCandidateReviewApprovalClaimResult;
  try {
    claim = await dependencies.claimReview(review.id);
  } catch {
    throw new ScoutWorkflowError("SCOUT_APPROVAL_INVALID_STATE");
  }

  if (!claim.changed) {
    if (claim.review.status === "CONVERTED" && claim.review.leadId !== undefined) {
      return convertedOutcome(claim.review.leadId, true);
    }
    if (claim.review.status !== "APPROVING") {
      throw new ScoutWorkflowError("SCOUT_APPROVAL_INVALID_STATE");
    }
    return reconcileApproval(claim.review, dependencies);
  }

  // This request owns APPROVING. Check a previous successful create before any new write.
  let existingLead: { id: string } | null;
  try {
    existingLead = await dependencies.findLeadByProvenance(review.source.type, review.discoveryId);
  } catch {
    return releaseProvenNoWriteClaim(review.id, "SCOUT_APPROVAL_RETRYABLE", dependencies);
  }
  if (existingLead !== null) {
    try {
      await dependencies.markConverted(review.id, existingLead.id);
    } catch {
      throw new ScoutWorkflowError("SCOUT_APPROVAL_RECONCILIATION_PENDING");
    }
    return convertedOutcome(existingLead.id, true);
  }

  try {
    const created = await dependencies.persistLead(approved);
    const lead = leadIdResultSchema.safeParse(created.lead);
    if (!lead.success) throw new Error("Lead creation result is invalid.");
    await dependencies.markConverted(review.id, lead.data.id);
    return convertedOutcome(lead.data.id);
  } catch (error) {
    const noWriteFailure = provenNoWriteLeadFailure(error);
    if (noWriteFailure === "DUPLICATE") {
      return releaseProvenNoWriteClaim(review.id, "SCOUT_APPROVAL_DUPLICATE_CONFLICT", dependencies);
    }
    if (noWriteFailure === "RETRYABLE") {
      return releaseProvenNoWriteClaim(review.id, "SCOUT_APPROVAL_RETRYABLE", dependencies);
    }

    // A create may have committed before an unknown error or a failed conversion mark.
    return reconcileApproval(review, dependencies).catch((reconciliationError) => {
      if (reconciliationError instanceof ScoutWorkflowError) {
        if (reconciliationError.code === "SCOUT_APPROVAL_IN_PROGRESS") {
          throw new ScoutWorkflowError("SCOUT_APPROVAL_RECONCILIATION_PENDING");
        }
        throw reconciliationError;
      }
      throw new ScoutWorkflowError("SCOUT_APPROVAL_RECONCILIATION_PENDING");
    });
  }
}

/** Rejects only a pending persisted review; no browser candidate facts are accepted. */
export async function rejectScoutCandidateReviewForWorkflow(
  id: string,
  dependencies: ScoutWorkflowDependencies = liveDependencies(),
): Promise<ScoutCandidateReviewTransitionResult> {
  const reviewId = parseReviewId(id);
  try {
    return await dependencies.rejectReview(reviewId);
  } catch {
    throw new ScoutWorkflowError("SCOUT_APPROVAL_INVALID_STATE");
  }
}
