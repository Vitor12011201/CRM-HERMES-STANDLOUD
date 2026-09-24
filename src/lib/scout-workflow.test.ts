import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import {
  ScoutLeadApprovalError,
  type ApprovedScoutLeadCreation,
} from "@/lib/scout-lead-approval";
import { ScoutExistingLeadReferenceReadError } from "@/lib/services/leads";
import type {
  ScoutCandidateReview,
  ScoutCandidateReviewTransitionResult,
} from "@/lib/scout-candidate-review";
import type { ScoutDiscoveryCandidate, ScoutResult } from "@/lib/scout/contracts";
import {
  ScoutWorkflowError,
  approveScoutCandidateReview,
  discoverScoutCandidateForReview,
  rejectScoutCandidateReviewForWorkflow,
  type ScoutWorkflowDependencies,
} from "./scout-workflow";

const input = {
  city: "Jacarei",
  region: "SP",
  segment: "Contabilidade",
  requirePublicWebsite: true,
  limit: 20,
};

function candidate(overrides: Partial<ScoutDiscoveryCandidate> = {}): ScoutDiscoveryCandidate {
  return {
    discoveryId: "fsq-1",
    companyName: "Atlas Contabilidade",
    city: "Jacarei",
    region: "SP",
    segment: "Contabilidade",
    websiteUrl: "https://atlas.example.test",
    source: { type: "FOURSQUARE", url: "https://foursquare.test/fsq-1" },
    ...overrides,
  };
}

function found(overrides: Partial<ScoutResult> = {}): ScoutResult {
  return {
    outcome: "FOUND",
    candidate: candidate(),
    basis: ["Discovery record reports city as Jacarei and region as SP."],
    unresolvedQuestions: [],
    ...overrides,
  } as ScoutResult;
}

function review(overrides: Partial<ScoutCandidateReview> = {}): ScoutCandidateReview {
  const now = new Date("2026-09-23T00:00:00.000Z");
  return {
    id: "review-1",
    discoveryId: "fsq-1",
    companyName: "Atlas Contabilidade",
    city: "Jacarei",
    region: "SP",
    segment: "Contabilidade",
    websiteUrl: "https://atlas.example.test",
    source: { type: "FOURSQUARE", url: "https://foursquare.test/fsq-1" },
    basis: ["Discovery record reports city as Jacarei and region as SP."],
    unresolvedQuestions: [],
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function transition(nextReview: ScoutCandidateReview, changed: boolean): ScoutCandidateReviewTransitionResult {
  return { review: nextReview, changed };
}

function dependencies(overrides: Partial<ScoutWorkflowDependencies> = {}) {
  const pending = review();
  const approving = review({ status: "APPROVING", reviewedAt: new Date("2026-09-23T01:00:00.000Z") });
  const provider = { provider: "SYNTHETIC" as const, discover: vi.fn() };
  const value: ScoutWorkflowDependencies = {
    provider,
    discoverCandidates: vi.fn().mockResolvedValue([candidate()]),
    listSeenIdentities: vi.fn().mockResolvedValue([]),
    listExistingLeadReferences: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnValue(found()),
    persistReview: vi.fn().mockResolvedValue({ review: pending, created: true }),
    getReview: vi.fn().mockResolvedValue(pending),
    claimReview: vi.fn().mockResolvedValue({ changed: true }),
    releaseReview: vi.fn().mockResolvedValue(transition(pending, true)),
    markConverted: vi.fn().mockResolvedValue(transition(review({
      status: "CONVERTED",
      leadId: "lead-1",
      reviewedAt: approving.reviewedAt,
    }), true)),
    rejectReview: vi.fn().mockResolvedValue(transition(review({
      status: "REJECTED",
      reviewedAt: new Date("2026-09-23T01:00:00.000Z"),
    }), true)),
    findLeadByProvenance: vi.fn().mockResolvedValue(null),
    prepareLead: vi.fn().mockReturnValue({} as ApprovedScoutLeadCreation),
    persistLead: vi.fn().mockResolvedValue({ candidateLead: {}, lead: { id: "lead-1" } }),
    ...overrides,
  };
  return value;
}

describe("Scout workflow discovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects browser input outside the limited discovery contract before provider access", async () => {
    const deps = dependencies();
    await expect(discoverScoutCandidateForReview({ ...input, apiKey: "never" }, deps)).rejects
      .toMatchObject({ code: "SCOUT_WORKFLOW_DISCOVERY_INPUT_INVALID" });
    expect(deps.discoverCandidates).not.toHaveBeenCalled();
  });

  it("filters exact seen identities while preserving unseen provider order and passes CRM refs to frozen Scout", async () => {
    const firstUnseen = candidate({ discoveryId: "fsq-2", companyName: "Primeira" });
    const secondUnseen = candidate({ discoveryId: "fsq-3", companyName: "Segunda" });
    const existingReferences = [{ id: "lead-existing", companyName: "Outra Empresa" }];
    const deps = dependencies({
      discoverCandidates: vi.fn().mockResolvedValue([candidate(), firstUnseen, secondUnseen]),
      listSeenIdentities: vi.fn().mockResolvedValue([{ sourceType: "FOURSQUARE", discoveryId: "fsq-1" }]),
      listExistingLeadReferences: vi.fn().mockResolvedValue(existingReferences),
      select: vi.fn().mockReturnValue(found({ candidate: firstUnseen })),
    });

    const outcome = await discoverScoutCandidateForReview(input, deps);

    expect(outcome).toMatchObject({ outcome: "FOUND", review: { status: "PENDING" } });
    expect(deps.select).toHaveBeenCalledWith(expect.objectContaining({
      discoveryCandidates: [firstUnseen, secondUnseen],
      existingLeadReferences: existingReferences,
    }));
    expect(deps.persistReview).toHaveBeenCalledWith(expect.objectContaining({ outcome: "FOUND" }));
  });

  it("does not persist a review when frozen Scout returns NONE", async () => {
    const deps = dependencies({
      select: vi.fn().mockReturnValue({ outcome: "NONE", reason: "NO_ELIGIBLE_CANDIDATE", unresolvedQuestions: [] }),
    });

    await expect(discoverScoutCandidateForReview(input, deps)).resolves.toEqual({
      outcome: "NONE",
      reason: "NO_ELIGIBLE_CANDIDATE",
    });
    expect(deps.persistReview).not.toHaveBeenCalled();
  });

  it("does not rediscover rejected or converted identities", async () => {
    const rejected = candidate({ discoveryId: "rejected" });
    const converted = candidate({ discoveryId: "converted" });
    const deps = dependencies({
      discoverCandidates: vi.fn().mockResolvedValue([rejected, converted]),
      listSeenIdentities: vi.fn().mockResolvedValue([
        { sourceType: "FOURSQUARE", discoveryId: "rejected" },
        { sourceType: "FOURSQUARE", discoveryId: "converted" },
      ]),
    });

    await expect(discoverScoutCandidateForReview(input, deps)).resolves.toEqual({
      outcome: "NONE",
      reason: "NO_NEW_CANDIDATE",
    });
    expect(deps.select).not.toHaveBeenCalled();
    expect(deps.persistReview).not.toHaveBeenCalled();
  });

  it("sanitizes provider failures without preserving external error text", async () => {
    const sensitiveText = "api-key=should-not-leak";
    const deps = dependencies({ discoverCandidates: vi.fn().mockRejectedValue(new Error(sensitiveText)) });

    await expect(discoverScoutCandidateForReview(input, deps)).rejects.toMatchObject({
      code: "SCOUT_WORKFLOW_DISCOVERY_FAILED",
    });
    await expect(discoverScoutCandidateForReview(input, deps)).rejects.not.toThrow(sensitiveText);
  });
});

describe("Scout workflow approval", () => {
  it("validates unresolved acknowledgement before claiming or writing", async () => {
    const unresolved = review({ unresolvedQuestions: ["Confirm business contact availability."] });
    const deps = dependencies({
      getReview: vi.fn().mockResolvedValue(unresolved),
      prepareLead: vi.fn().mockImplementation((_result, approval) => {
        if (approval.acknowledgeUnresolvedQuestions !== true) {
          throw new ScoutLeadApprovalError("INVALID_SCOUT_LEAD_APPROVAL");
        }
        return {} as ApprovedScoutLeadCreation;
      }),
    });

    await expect(approveScoutCandidateReview(unresolved.id, {}, deps)).rejects
      .toMatchObject({ code: "SCOUT_APPROVAL_INPUT_INVALID" });
    expect(deps.claimReview).not.toHaveBeenCalled();
    expect(deps.persistLead).not.toHaveBeenCalled();
  });

  it("lets only a PENDING claim owner persist through the Phase 1 boundary and convert", async () => {
    const deps = dependencies();

    await expect(approveScoutCandidateReview("review-1", {}, deps)).resolves.toEqual({
      outcome: "CONVERTED",
      leadId: "lead-1",
    });
    expect(deps.prepareLead).toHaveBeenCalledWith(expect.objectContaining({ outcome: "FOUND" }), { approved: true });
    expect(deps.persistLead).toHaveBeenCalledTimes(1);
    expect(deps.markConverted).toHaveBeenCalledWith("review-1", "lead-1");
  });

  it("returns CONVERTED for a claim loser that observes a converted review without more work", async () => {
    const converted = review({
      status: "CONVERTED",
      leadId: "lead-existing",
      reviewedAt: new Date("2026-09-23T01:00:00.000Z"),
    });
    const deps = dependencies({
      claimReview: vi.fn().mockResolvedValue({ changed: false, review: converted }),
    });

    await expect(approveScoutCandidateReview("review-1", {}, deps)).resolves.toEqual({
      outcome: "CONVERTED",
      leadId: "lead-existing",
      reconciled: true,
    });
    expect(deps.persistLead).not.toHaveBeenCalled();
    expect(deps.findLeadByProvenance).not.toHaveBeenCalled();
    expect(deps.markConverted).not.toHaveBeenCalled();
    expect(deps.releaseReview).not.toHaveBeenCalled();
  });

  it("reconciles an APPROVING retry with exact provenance and never creates another Lead", async () => {
    const approving = review({ status: "APPROVING", reviewedAt: new Date("2026-09-23T01:00:00.000Z") });
    const deps = dependencies({
      getReview: vi.fn().mockResolvedValue(approving),
      findLeadByProvenance: vi.fn().mockResolvedValue({ id: "lead-existing" }),
    });

    await expect(approveScoutCandidateReview("review-1", {}, deps)).resolves.toEqual({
      outcome: "CONVERTED",
      leadId: "lead-existing",
      reconciled: true,
    });
    expect(deps.persistLead).not.toHaveBeenCalled();
    expect(deps.prepareLead).not.toHaveBeenCalled();
    expect(deps.claimReview).not.toHaveBeenCalled();
    expect(deps.releaseReview).not.toHaveBeenCalled();
    expect(deps.markConverted).toHaveBeenCalledWith("review-1", "lead-existing");
  });

  it("keeps APPROVING when retry reconciliation cannot find provenance and never writes", async () => {
    const approving = review({ status: "APPROVING", reviewedAt: new Date("2026-09-23T01:00:00.000Z") });
    const deps = dependencies({
      getReview: vi.fn().mockResolvedValue(approving),
    });

    await expect(approveScoutCandidateReview("review-1", {}, deps)).rejects
      .toMatchObject({ code: "SCOUT_APPROVAL_IN_PROGRESS" });
    expect(deps.prepareLead).not.toHaveBeenCalled();
    expect(deps.claimReview).not.toHaveBeenCalled();
    expect(deps.persistLead).not.toHaveBeenCalled();
    expect(deps.releaseReview).not.toHaveBeenCalled();
  });

  it("reconciles an APPROVING review with unresolved questions without a new acknowledgement or create", async () => {
    const approving = review({
      status: "APPROVING",
      reviewedAt: new Date("2026-09-23T01:00:00.000Z"),
      unresolvedQuestions: ["Confirm business contact availability."],
    });
    const deps = dependencies({
      getReview: vi.fn().mockResolvedValue(approving),
      findLeadByProvenance: vi.fn().mockResolvedValue({ id: "lead-existing" }),
    });

    await expect(approveScoutCandidateReview("review-1", {}, deps)).resolves.toEqual({
      outcome: "CONVERTED",
      leadId: "lead-existing",
      reconciled: true,
    });
    expect(deps.prepareLead).not.toHaveBeenCalled();
    expect(deps.claimReview).not.toHaveBeenCalled();
    expect(deps.persistLead).not.toHaveBeenCalled();
    expect(deps.releaseReview).not.toHaveBeenCalled();
  });

  it("releases the owner claim when pre-create provenance lookup fails", async () => {
    const deps = dependencies({
      findLeadByProvenance: vi.fn().mockRejectedValue(new Error("CRM read unavailable")),
    });

    await expect(approveScoutCandidateReview("review-1", {}, deps)).rejects
      .toMatchObject({ code: "SCOUT_APPROVAL_RETRYABLE" });
    expect(deps.releaseReview).toHaveBeenCalledWith("review-1");
    expect(deps.persistLead).not.toHaveBeenCalled();
  });

  it("releases the owner claim for a proven duplicate-context read failure", async () => {
    const deps = dependencies({
      persistLead: vi.fn().mockRejectedValue(new ScoutExistingLeadReferenceReadError(
        "SCOUT_EXISTING_LEAD_REFERENCE_READ_FAILED",
      )),
    });

    await expect(approveScoutCandidateReview("review-1", {}, deps)).rejects
      .toMatchObject({ code: "SCOUT_APPROVAL_RETRYABLE" });
    expect(deps.releaseReview).toHaveBeenCalledWith("review-1");
    expect(deps.findLeadByProvenance).toHaveBeenCalledTimes(1);
  });

  it.each(["SCOUT_LEAD_EXACT_DUPLICATE", "SCOUT_LEAD_AMBIGUOUS_DUPLICATE"] as const)(
    "releases owner claim for known no-write %s conflicts",
    async (code) => {
      const deps = dependencies({
        persistLead: vi.fn().mockRejectedValue(new ScoutLeadApprovalError(code)),
      });

      await expect(approveScoutCandidateReview("review-1", {}, deps)).rejects
        .toMatchObject({ code: "SCOUT_APPROVAL_DUPLICATE_CONFLICT" });
      expect(deps.releaseReview).toHaveBeenCalledWith("review-1");
    },
  );

  it("recovers an unknown owner outcome when exact provenance appears", async () => {
    const deps = dependencies({
      persistLead: vi.fn().mockRejectedValue(new Error("unknown write outcome")),
      findLeadByProvenance: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "lead-recovered" }),
    });

    await expect(approveScoutCandidateReview("review-1", {}, deps)).resolves.toEqual({
      outcome: "CONVERTED",
      leadId: "lead-recovered",
      reconciled: true,
    });
    expect(deps.releaseReview).not.toHaveBeenCalled();
  });

  it("fails closed in APPROVING when an unknown owner outcome cannot be reconciled", async () => {
    const deps = dependencies({ persistLead: vi.fn().mockRejectedValue(new Error("unknown write outcome")) });

    await expect(approveScoutCandidateReview("review-1", {}, deps)).rejects
      .toMatchObject({ code: "SCOUT_APPROVAL_RECONCILIATION_PENDING" });
    expect(deps.releaseReview).not.toHaveBeenCalled();
  });

  it("retries a failed converted mark through provenance without a second Lead create", async () => {
    const pending = review();
    const approving = review({
      status: "APPROVING",
      reviewedAt: new Date("2026-09-23T01:00:00.000Z"),
    });
    const deps = dependencies({
      getReview: vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(approving),
      markConverted: vi.fn()
        .mockRejectedValueOnce(new Error("conversion mark interrupted"))
        .mockResolvedValue(transition(review({
          status: "CONVERTED",
          leadId: "lead-1",
          reviewedAt: new Date("2026-09-23T01:00:00.000Z"),
        }), true)),
      findLeadByProvenance: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "lead-1" }),
    });

    await expect(approveScoutCandidateReview("review-1", {}, deps)).rejects
      .toMatchObject({ code: "SCOUT_APPROVAL_RECONCILIATION_PENDING" });
    await expect(approveScoutCandidateReview("review-1", {}, deps)).resolves.toEqual({
      outcome: "CONVERTED",
      leadId: "lead-1",
      reconciled: true,
    });
    expect(deps.persistLead).toHaveBeenCalledTimes(1);
  });

  it("rejects only through the persisted transition and never touches Lead creation", async () => {
    const deps = dependencies();

    await expect(rejectScoutCandidateReviewForWorkflow("review-1", deps)).resolves
      .toMatchObject({ review: { status: "REJECTED" } });
    expect(deps.persistLead).not.toHaveBeenCalled();
  });

  it("sanitizes an invalid reject state without a Lead mutation", async () => {
    const deps = dependencies({
      rejectReview: vi.fn().mockRejectedValue(new Error("APPROVING")),
    });

    await expect(rejectScoutCandidateReviewForWorkflow("review-1", deps)).rejects
      .toMatchObject({ code: "SCOUT_APPROVAL_INVALID_STATE" });
    expect(deps.persistLead).not.toHaveBeenCalled();
  });
});

describe("Scout workflow error contract", () => {
  it("is a sanitized error class", () => {
    const error = new ScoutWorkflowError("SCOUT_APPROVAL_IN_PROGRESS");
    expect(error.message).toBe("SCOUT_APPROVAL_IN_PROGRESS");
    expect(error.stack).not.toContain("api-key=");
  });
});
