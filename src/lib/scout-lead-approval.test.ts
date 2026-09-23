import { describe, expect, it, vi } from "vitest";

import { scoutResultSchema, type ScoutResult } from "@/lib/scout/contracts";

const serviceMocks = vi.hoisted(() => ({
  createLead: vi.fn(),
  listScoutExistingLeadReferences: vi.fn(),
}));

vi.mock("@/lib/services/leads", () => ({
  createLead: serviceMocks.createLead,
  listScoutExistingLeadReferences: serviceMocks.listScoutExistingLeadReferences,
}));

import {
  persistApprovedScoutLeadCreation,
  prepareApprovedScoutLeadCreation,
  ScoutLeadApprovalError,
  toCandidateLead,
  type ApprovedScoutLeadCreationStore,
} from "./scout-lead-approval";

function foundResult(overrides: Partial<Extract<ScoutResult, { outcome: "FOUND" }>> = {}): ScoutResult {
  return {
    outcome: "FOUND",
    candidate: {
      discoveryId: "fsq-123",
      companyName: "Atlas Contabilidade",
      city: "Jacarei",
      region: "SP",
      segment: "Contabilidade",
      websiteUrl: "https://atlas.example/",
      source: { type: "FOURSQUARE" },
    },
    basis: ["Discovery candidate matches segment Contabilidade."],
    unresolvedQuestions: [],
    ...overrides,
  };
}

function store(references: readonly object[] = []): ApprovedScoutLeadCreationStore {
  return {
    listExistingLeadReferences: vi.fn().mockResolvedValue(references),
    createLead: vi.fn().mockResolvedValue({ id: "lead-created" }),
  };
}

describe("Scout FOUND human approval", () => {
  it("does not allow Scout NONE to become an approved creation", () => {
    const result: ScoutResult = {
      outcome: "NONE",
      reason: "NO_ELIGIBLE_CANDIDATE",
      unresolvedQuestions: [],
    };

    expect(() => prepareApprovedScoutLeadCreation(result, { approved: true })).toThrowError(
      new ScoutLeadApprovalError("SCOUT_RESULT_NOT_FOUND"),
    );
  });

  it.each([{ approved: false }, {}, { approved: true, extra: "no" }])(
    "requires a strict approved: true payload: %o",
    (approval) => {
      expect(() => prepareApprovedScoutLeadCreation(foundResult(), approval as never)).toThrowError(
        new ScoutLeadApprovalError("INVALID_SCOUT_LEAD_APPROVAL"),
      );
    },
  );

  it("creates an opaque approved batch for a resolved FOUND result", () => {
    const approved = prepareApprovedScoutLeadCreation(foundResult(), { approved: true });

    expect(approved.candidateLead).toEqual({
      companyName: "Atlas Contabilidade",
      city: "Jacarei",
      region: "SP",
      segment: "Contabilidade",
      websiteUrl: "https://atlas.example/",
      source: "SCOUT:FOURSQUARE:fsq-123",
      qualificationScore: 0,
      status: "NEW",
    });
  });

  it("requires explicit acknowledgement for unresolved questions", () => {
    const unresolved = foundResult({ unresolvedQuestions: ["Possible duplicate."] });

    expect(() => prepareApprovedScoutLeadCreation(unresolved, { approved: true })).toThrowError(
      new ScoutLeadApprovalError("INVALID_SCOUT_LEAD_APPROVAL"),
    );
    expect(() => prepareApprovedScoutLeadCreation(unresolved, {
      approved: true,
      acknowledgeUnresolvedQuestions: true,
    })).not.toThrow();
  });

  it("fails closed when a Scout-valid company name exceeds the CRM Lead limit", () => {
    const result = foundResult();
    if (result.outcome === "FOUND") {
      result.candidate.companyName = "A".repeat(161);
    }

    expect(scoutResultSchema.safeParse(result).success).toBe(true);
    expect(() => prepareApprovedScoutLeadCreation(result, { approved: true })).toThrowError(
      new ScoutLeadApprovalError("SCOUT_LEAD_CANDIDATE_INVALID"),
    );
  });

  it("maps only candidate facts, deterministic provenance, NEW, and zero score", () => {
    const result = foundResult() as Extract<ScoutResult, { outcome: "FOUND" }>;
    const candidateLead = toCandidateLead(result);

    expect(candidateLead).toEqual({
      companyName: "Atlas Contabilidade",
      city: "Jacarei",
      region: "SP",
      segment: "Contabilidade",
      websiteUrl: "https://atlas.example/",
      source: "SCOUT:FOURSQUARE:fsq-123",
      qualificationScore: 0,
      status: "NEW",
    });
    expect(candidateLead).not.toHaveProperty("mainProblem");
    expect(candidateLead).not.toHaveProperty("primaryService");
    expect(candidateLead).not.toHaveProperty("notes");
  });

  it("freezes the approved snapshot and all mutable nested values", () => {
    const approved = prepareApprovedScoutLeadCreation(foundResult(), { approved: true });

    expect(Object.isFrozen(approved)).toBe(true);
    expect(Object.isFrozen(approved.candidateLead)).toBe(true);
    expect(Object.isFrozen(approved.scoutCandidate)).toBe(true);
    expect(Object.isFrozen(approved.scoutCandidate.source)).toBe(true);
  });

  it("blocks post-approval mutation attempts without changing the snapshot", () => {
    const approved = prepareApprovedScoutLeadCreation(foundResult(), { approved: true });

    expect(() => { (approved.candidateLead as { companyName: string }).companyName = "Boreal"; }).toThrow(TypeError);
    expect(() => { (approved.candidateLead as { status: string }).status = "QUALIFIED"; }).toThrow(TypeError);
    expect(() => { (approved.scoutCandidate as { companyName: string }).companyName = "Boreal"; }).toThrow(TypeError);
    expect(() => { (approved.scoutCandidate as { websiteUrl?: string }).websiteUrl = "https://boreal.example/"; }).toThrow(TypeError);
    expect(() => { (approved.scoutCandidate.source as { type: string }).type = "OTHER"; }).toThrow(TypeError);

    expect(approved.candidateLead.companyName).toBe("Atlas Contabilidade");
    expect(approved.candidateLead.source).toBe("SCOUT:FOURSQUARE:fsq-123");
    expect(approved.candidateLead.status).toBe("NEW");
    expect(approved.scoutCandidate.companyName).toBe("Atlas Contabilidade");
    expect(approved.scoutCandidate.websiteUrl).toBe("https://atlas.example/");
    expect(approved.scoutCandidate.source.type).toBe("FOURSQUARE");
  });
});

describe("approved Scout Lead persistence", () => {
  it("rejects a forged object that lacks the module-private approval marker", async () => {
    const persistenceStore = store();
    const forged = { candidateLead: {}, scoutCandidate: {} };

    await expect(persistApprovedScoutLeadCreation(forged as never, persistenceStore)).rejects.toEqual(
      new ScoutLeadApprovalError("UNAPPROVED_SCOUT_LEAD_CREATION"),
    );
    expect(persistenceStore.listExistingLeadReferences).not.toHaveBeenCalled();
    expect(persistenceStore.createLead).not.toHaveBeenCalled();
  });

  it("creates exactly once after a live DISTINCT recheck", async () => {
    const persistenceStore = store([{
      id: "other-lead",
      companyName: "Boreal Contabilidade",
      city: "Sao Paulo",
      region: "SP",
      websiteUrl: "https://boreal.example/",
    }]);
    const approved = prepareApprovedScoutLeadCreation(foundResult(), { approved: true });

    await expect(persistApprovedScoutLeadCreation(approved, persistenceStore)).resolves.toMatchObject({
      lead: { id: "lead-created" },
    });
    expect(persistenceStore.createLead).toHaveBeenCalledTimes(1);
  });

  it("never writes when the live recheck finds an exact duplicate", async () => {
    const persistenceStore = store([{
      id: "lead-1",
      companyName: "Existing name is irrelevant for URL match",
      websiteUrl: "https://atlas.example/",
    }]);
    const approved = prepareApprovedScoutLeadCreation(foundResult(), { approved: true });

    await expect(persistApprovedScoutLeadCreation(approved, persistenceStore)).rejects.toEqual(
      new ScoutLeadApprovalError("SCOUT_LEAD_EXACT_DUPLICATE"),
    );
    expect(persistenceStore.createLead).not.toHaveBeenCalled();
  });

  it("never writes when the live recheck is ambiguous", async () => {
    const persistenceStore = store([{
      id: "lead-1",
      companyName: "Atlas Contabilidade",
      city: "Jacarei",
      region: "SP",
    }]);
    const approved = prepareApprovedScoutLeadCreation(foundResult(), { approved: true });

    await expect(persistApprovedScoutLeadCreation(approved, persistenceStore)).rejects.toEqual(
      new ScoutLeadApprovalError("SCOUT_LEAD_AMBIGUOUS_DUPLICATE"),
    );
    expect(persistenceStore.createLead).not.toHaveBeenCalled();
  });

  it("blocks a retry when the just-created Lead appears in the next live recheck", async () => {
    const persistenceStore = store();
    const refs = persistenceStore.listExistingLeadReferences as ReturnType<typeof vi.fn>;
    refs.mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: "lead-created",
      companyName: "Atlas Contabilidade",
      city: "Jacarei",
      region: "SP",
      websiteUrl: "https://atlas.example/",
    }]);
    const approved = prepareApprovedScoutLeadCreation(foundResult(), { approved: true });

    await persistApprovedScoutLeadCreation(approved, persistenceStore);
    await expect(persistApprovedScoutLeadCreation(approved, persistenceStore)).rejects.toEqual(
      new ScoutLeadApprovalError("SCOUT_LEAD_EXACT_DUPLICATE"),
    );
    expect(persistenceStore.createLead).toHaveBeenCalledTimes(1);
  });

  it("uses one immutable snapshot for duplicate assessment and the resulting create", async () => {
    const persistenceStore = store([{
      id: "lead-b",
      companyName: "Boreal Contabilidade",
      city: "Jacarei",
      region: "SP",
      websiteUrl: "https://boreal.example/",
    }]);
    const approved = prepareApprovedScoutLeadCreation(foundResult(), { approved: true });

    expect(() => { (approved.candidateLead as { companyName: string }).companyName = "Boreal Contabilidade"; }).toThrow(TypeError);
    expect(() => { (approved.candidateLead as { websiteUrl?: string }).websiteUrl = "https://boreal.example/"; }).toThrow(TypeError);
    expect(() => { (approved.scoutCandidate as { companyName: string }).companyName = "Boreal Contabilidade"; }).toThrow(TypeError);
    expect(() => { (approved.scoutCandidate as { websiteUrl?: string }).websiteUrl = "https://boreal.example/"; }).toThrow(TypeError);

    await persistApprovedScoutLeadCreation(approved, persistenceStore);

    expect(persistenceStore.createLead).toHaveBeenCalledWith({
      companyName: "Atlas Contabilidade",
      city: "Jacarei",
      region: "SP",
      segment: "Contabilidade",
      websiteUrl: "https://atlas.example/",
      source: "SCOUT:FOURSQUARE:fsq-123",
      qualificationScore: 0,
      status: "NEW",
    });
  });
});
