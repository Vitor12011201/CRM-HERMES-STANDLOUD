import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LeadEvidenceInput } from "@/lib/services/lead-research";

import {
  ResearchEvidenceApprovalError,
  persistApprovedResearchEvidence,
  prepareApprovedResearchEvidence,
  selectApprovedResearchEvidence,
  toCandidateResearchEvidence,
  type ApprovedResearchEvidenceStore,
  type ExactStoredLeadEvidence,
} from "./evidence-approval";
import { researcherResultSchema } from "./contracts";

const leadId = "lead-approved-research";
const evidence = [
  {
    sourceType: "WEBSITE",
    sourceUrl: "https://company.example",
    observation: "A página apresenta um formulário de contato.",
  },
  {
    sourceType: "GOOGLE_MAPS",
    observation: "O perfil registra 8 avaliações.",
  },
  {
    sourceType: "INSTAGRAM",
    sourceUrl: "https://instagram.example/company",
    observation: "O perfil mostra uma publicação recente.",
  },
] as const;

function resultWithEvidence() {
  return researcherResultSchema.parse({
    evidence,
    unresolvedQuestions: ["Não foi possível confirmar a nota média."],
    confidence: "LOW",
  });
}

function createFakeStore(initial: ExactStoredLeadEvidence[] = []) {
  const stored = [...initial];
  const store: ApprovedResearchEvidenceStore = {
    listEvidenceForLead: vi.fn(async () => stored),
    createEvidence: vi.fn(async (_leadId, input) => {
      stored.push(input);
      return { id: `evidence-${stored.length}`, ...input };
    }),
  };

  return { store, stored };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Researcher evidence human approval boundary", () => {
  it("gives each validated evidence a stable result-local candidate index", () => {
    expect(toCandidateResearchEvidence(resultWithEvidence())).toEqual([
      { index: 0, evidence: evidence[0] },
      { index: 1, evidence: evidence[1] },
      { index: 2, evidence: evidence[2] },
    ]);
  });

  it("selects only explicitly approved indexes in deterministic order", () => {
    const selected = selectApprovedResearchEvidence(resultWithEvidence(), [2, 0]);

    expect(selected).toEqual([
      { index: 0, evidence: evidence[0] },
      { index: 2, evidence: evidence[2] },
    ]);
  });

  it("allows an empty approval and leaves the original result unchanged", () => {
    const result = resultWithEvidence();
    const before = JSON.stringify(result);

    expect(selectApprovedResearchEvidence(result, [])).toEqual([]);
    expect(JSON.stringify(result)).toBe(before);
  });

  it.each([
    { indexes: [3], code: "APPROVED_INDEX_OUT_OF_RANGE" },
    { indexes: [-1], code: "INVALID_APPROVAL" },
    { indexes: [0, 0], code: "INVALID_APPROVAL" },
  ])("fails closed for invalid explicit approval $indexes", ({ indexes, code }) => {
    expect(() => selectApprovedResearchEvidence(resultWithEvidence(), indexes)).toThrow(
      new ResearchEvidenceApprovalError(code as "INVALID_APPROVAL" | "APPROVED_INDEX_OUT_OF_RANGE"),
    );
  });

  it("converts approved evidence byte-for-byte without confidence or unresolved questions", () => {
    const batch = prepareApprovedResearchEvidence(resultWithEvidence(), {
      leadId,
      approvedEvidenceIndexes: [0, 1],
    });

    expect(batch.evidence).toEqual([evidence[0], evidence[1]]);
    expect(batch.evidence[0].observation).toBe(evidence[0].observation);
    expect(batch.evidence[0].sourceUrl).toBe(evidence[0].sourceUrl);
    expect(batch.evidence[1]).not.toHaveProperty("sourceUrl");
    expect(batch.evidence[0]).not.toHaveProperty("confidence");
    expect(batch.evidence[0]).not.toHaveProperty("unresolvedQuestions");
  });

  it("accepts an empty result only with empty approval", () => {
    const emptyResult = researcherResultSchema.parse({
      evidence: [],
      unresolvedQuestions: ["Nenhuma fonte foi confirmada."],
      confidence: "LOW",
    });

    expect(prepareApprovedResearchEvidence(emptyResult, {
      leadId,
      approvedEvidenceIndexes: [],
    }).evidence).toEqual([]);
    expect(() => prepareApprovedResearchEvidence(emptyResult, {
      leadId,
      approvedEvidenceIndexes: [0],
    })).toThrow(new ResearchEvidenceApprovalError("APPROVED_INDEX_OUT_OF_RANGE"));
  });

  it("requires a non-empty leadId as part of the explicit approval input", () => {
    expect(() => prepareApprovedResearchEvidence(resultWithEvidence(), {
      leadId: "",
      approvedEvidenceIndexes: [0],
    })).toThrow(new ResearchEvidenceApprovalError("INVALID_APPROVAL"));
  });

  it("writes only approved evidence through the injected store with deterministic AGENT capture", async () => {
    const batch = prepareApprovedResearchEvidence(resultWithEvidence(), {
      leadId,
      approvedEvidenceIndexes: [0, 2],
    });
    const { store } = createFakeStore();

    const persisted = await persistApprovedResearchEvidence(batch, store);

    expect(persisted.created).toEqual([evidence[0], evidence[2]]);
    expect(persisted.skippedExactDuplicates).toEqual([]);
    expect(store.createEvidence).toHaveBeenCalledTimes(2);
    expect(store.createEvidence).toHaveBeenNthCalledWith(1, leadId, evidence[0], { capturedBy: "AGENT" });
    expect(store.createEvidence).toHaveBeenNthCalledWith(2, leadId, evidence[2], { capturedBy: "AGENT" });
    expect(store.createEvidence).not.toHaveBeenCalledWith(leadId, evidence[1], expect.anything());
  });

  it("skips exact duplicates deterministically when the same approval is repeated", async () => {
    const batch = prepareApprovedResearchEvidence(resultWithEvidence(), {
      leadId,
      approvedEvidenceIndexes: [0, 2],
    });
    const { store } = createFakeStore();

    await persistApprovedResearchEvidence(batch, store);
    const repeated = await persistApprovedResearchEvidence(batch, store);

    expect(repeated.created).toEqual([]);
    expect(repeated.skippedExactDuplicates).toEqual([evidence[0], evidence[2]]);
    expect(store.createEvidence).toHaveBeenCalledTimes(2);
  });

  it("rejects arbitrary evidence that did not pass the explicit approval boundary", async () => {
    const { store } = createFakeStore();

    await expect(persistApprovedResearchEvidence({
      leadId,
      approvedEvidenceIndexes: [0],
      evidence: [evidence[0]],
    } as never, store)).rejects.toThrow(new ResearchEvidenceApprovalError("UNAPPROVED_BATCH"));
    expect(store.createEvidence).not.toHaveBeenCalled();
  });

  it("propagates persistence failures without reporting batch success", async () => {
    const batch = prepareApprovedResearchEvidence(resultWithEvidence(), {
      leadId,
      approvedEvidenceIndexes: [0, 2],
    });
    const { store, stored } = createFakeStore();
    const createEvidence = store.createEvidence as ReturnType<typeof vi.fn>;
    createEvidence.mockImplementationOnce(async (_leadId: string, input: LeadEvidenceInput) => {
      stored.push(input);
      return { id: "evidence-1", ...input };
    }).mockRejectedValueOnce(new Error("store failure"));

    await expect(persistApprovedResearchEvidence(batch, store)).rejects.toThrow("store failure");
    expect(store.createEvidence).toHaveBeenCalledTimes(2);
    expect(stored).toEqual([evidence[0]]);
  });
});
