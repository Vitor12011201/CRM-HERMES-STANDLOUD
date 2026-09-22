import { describe, expect, it, vi } from "vitest";

import type { LeadEvidenceDuplicateRecord, LeadEvidenceInput } from "@/lib/services/lead-research";

const serviceModuleMocks = vi.hoisted(() => ({
  addLeadEvidence: vi.fn(),
  listLeadEvidenceForDuplicateDetection: vi.fn(),
}));

vi.mock("@/lib/services/lead-research", () => ({
  addLeadEvidence: serviceModuleMocks.addLeadEvidence,
  listLeadEvidenceForDuplicateDetection: serviceModuleMocks.listLeadEvidenceForDuplicateDetection,
}));

import {
  persistApprovedResearchEvidence,
  prepareApprovedResearchEvidence,
  type ApprovedResearchEvidenceBatch,
} from "./evidence-approval";
import { createLeadEvidenceApprovedResearchStore, type LeadEvidenceApprovalService } from "./lead-evidence-store";

const leadId = "lead-approved";

const result = {
  evidence: [
    {
      sourceType: "WEBSITE" as const,
      sourceUrl: "https://example.com/home",
      observation: "A página apresenta telefone no rodapé.",
    },
    {
      sourceType: "GOOGLE_MAPS" as const,
      observation: "O cenário registra 8 avaliações.",
    },
    {
      sourceType: "WEBSITE" as const,
      sourceUrl: "https://example.com/services",
      observation: "A página lista serviços de contabilidade.",
    },
  ],
  unresolvedQuestions: ["A nota média não pôde ser confirmada."],
  confidence: "LOW" as const,
};

function createFakeService(existing: readonly LeadEvidenceDuplicateRecord[] = []) {
  const listLeadEvidenceForDuplicateDetection = vi.fn(async () => existing);
  const addLeadEvidence = vi.fn(async (_leadId: string, input: LeadEvidenceInput) => ({
    id: `stored-${input.observation}`,
    ...input,
  }));
  const service: LeadEvidenceApprovalService = {
    listLeadEvidenceForDuplicateDetection,
    addLeadEvidence,
  };

  return { service, listLeadEvidenceForDuplicateDetection, addLeadEvidence };
}

function approvedBatch(indexes: number[]): ApprovedResearchEvidenceBatch {
  return prepareApprovedResearchEvidence(result, { leadId, approvedEvidenceIndexes: indexes });
}

describe("LeadEvidence approved-research adapter", () => {
  it("creates one new approved evidence through the existing service with AGENT capture", async () => {
    const fake = createFakeService();
    const output = await persistApprovedResearchEvidence(
      approvedBatch([0]),
      createLeadEvidenceApprovedResearchStore(fake.service),
    );

    expect(fake.listLeadEvidenceForDuplicateDetection).toHaveBeenCalledWith(leadId);
    expect(fake.addLeadEvidence).toHaveBeenCalledExactlyOnceWith(
      leadId,
      result.evidence[0],
      { capturedBy: "AGENT" },
    );
    expect(output.created).toEqual([result.evidence[0]]);
  });

  it("writes three approved evidences in deterministic candidate-index order", async () => {
    const fake = createFakeService();
    await persistApprovedResearchEvidence(
      approvedBatch([2, 0, 1]),
      createLeadEvidenceApprovedResearchStore(fake.service),
    );

    expect(fake.addLeadEvidence).toHaveBeenNthCalledWith(1, leadId, result.evidence[0], { capturedBy: "AGENT" });
    expect(fake.addLeadEvidence).toHaveBeenNthCalledWith(2, leadId, result.evidence[1], { capturedBy: "AGENT" });
    expect(fake.addLeadEvidence).toHaveBeenNthCalledWith(3, leadId, result.evidence[2], { capturedBy: "AGENT" });
  });

  it("skips one exact existing duplicate and writes the remaining approved evidences", async () => {
    const fake = createFakeService([{ ...result.evidence[0] }]);
    const output = await persistApprovedResearchEvidence(
      approvedBatch([0, 1, 2]),
      createLeadEvidenceApprovedResearchStore(fake.service),
    );

    expect(fake.addLeadEvidence).toHaveBeenCalledTimes(2);
    expect(fake.addLeadEvidence).toHaveBeenNthCalledWith(1, leadId, result.evidence[1], { capturedBy: "AGENT" });
    expect(fake.addLeadEvidence).toHaveBeenNthCalledWith(2, leadId, result.evidence[2], { capturedBy: "AGENT" });
    expect(output.skippedExactDuplicates).toEqual([result.evidence[0]]);
  });

  it("normalizes stored null sourceUrl to absent and skips that exact duplicate", async () => {
    const fake = createFakeService([{
      sourceType: "GOOGLE_MAPS",
      sourceUrl: null,
      observation: result.evidence[1].observation,
    }]);
    const output = await persistApprovedResearchEvidence(
      approvedBatch([1]),
      createLeadEvidenceApprovedResearchStore(fake.service),
    );

    expect(fake.addLeadEvidence).not.toHaveBeenCalled();
    expect(output.skippedExactDuplicates).toEqual([result.evidence[1]]);
  });

  it("does not create evidence for an empty explicit approval", async () => {
    const fake = createFakeService();
    await persistApprovedResearchEvidence(
      approvedBatch([]),
      createLeadEvidenceApprovedResearchStore(fake.service),
    );

    expect(fake.addLeadEvidence).not.toHaveBeenCalled();
  });

  it("rejects an unapproved batch before calling the concrete service", async () => {
    const fake = createFakeService();
    await expect(persistApprovedResearchEvidence(
      result as unknown as ApprovedResearchEvidenceBatch,
      createLeadEvidenceApprovedResearchStore(fake.service),
    )).rejects.toMatchObject({ code: "UNAPPROVED_BATCH" });

    expect(fake.listLeadEvidenceForDuplicateDetection).not.toHaveBeenCalled();
    expect(fake.addLeadEvidence).not.toHaveBeenCalled();
  });

  it("propagates a second sequential service failure and does not report a third create as success", async () => {
    const fake = createFakeService();
    fake.addLeadEvidence
      .mockResolvedValueOnce({ id: "created-first" })
      .mockRejectedValueOnce(new Error("service create failed"));

    await expect(persistApprovedResearchEvidence(
      approvedBatch([0, 1, 2]),
      createLeadEvidenceApprovedResearchStore(fake.service),
    )).rejects.toThrow("service create failed");

    expect(fake.addLeadEvidence).toHaveBeenCalledTimes(2);
    expect(fake.addLeadEvidence).toHaveBeenNthCalledWith(1, leadId, result.evidence[0], { capturedBy: "AGENT" });
    expect(fake.addLeadEvidence).toHaveBeenNthCalledWith(2, leadId, result.evidence[1], { capturedBy: "AGENT" });
  });
});
