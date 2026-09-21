import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceNotFoundError } from "./errors";

const mocks = vi.hoisted(() => ({
  leadFindUnique: vi.fn(),
  leadUpdate: vi.fn(),
  leadUpdateMany: vi.fn(),
  evidenceCreate: vi.fn(),
  analysisUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    lead: {
      findUnique: mocks.leadFindUnique,
      update: mocks.leadUpdate,
      updateMany: mocks.leadUpdateMany,
    },
    leadEvidence: { create: mocks.evidenceCreate },
    leadAnalysis: { upsert: mocks.analysisUpsert },
  },
}));

import { addLeadEvidence, getLeadResearch, upsertLeadAnalysis } from "./lead-research";

const leadId = "lead-1";
let leadExists = true;
let storedAnalysis: Record<string, unknown> | null;

beforeEach(() => {
  vi.clearAllMocks();
  leadExists = true;
  storedAnalysis = null;
  mocks.leadFindUnique.mockImplementation(async (args: { select?: unknown }) => {
    if (!leadExists) return null;
    if (args.select) return { evidences: [{ id: "evidence-new" }], analysis: storedAnalysis, _count: { evidences: 1 } };
    return { id: leadId, qualificationScore: 8, status: "CONTACTED", lastContactAt: new Date("2026-09-20T12:00:00.000Z"), nextFollowUpAt: new Date("2026-09-22T00:00:00.000Z") };
  });
  mocks.evidenceCreate.mockImplementation(async ({ data }) => ({ id: "evidence-1", ...data }));
  mocks.analysisUpsert.mockImplementation(async ({ create, update }) => {
    storedAnalysis = storedAnalysis ? { ...storedAnalysis, ...update } : { id: "analysis-1", ...create };
    return storedAnalysis;
  });
});

describe("lead research services", () => {
  it("creates a factual WEBSITE evidence with a USER capture actor", async () => {
    const observedAt = new Date("2026-09-21T15:00:00.000Z");
    const evidence = await addLeadEvidence(leadId, {
      sourceType: "WEBSITE",
      sourceUrl: "https://empresa.example",
      observation: "O site apresenta um formulário de contato.",
      observedAt,
    }, { capturedBy: "USER" });

    expect(evidence).toMatchObject({ sourceType: "WEBSITE", capturedBy: "USER", observedAt });
    expect(mocks.evidenceCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ leadId, sourceUrl: "https://empresa.example" }) }));
  });

  it("creates a GOOGLE_MAPS evidence without changing commercial lead fields", async () => {
    await addLeadEvidence(leadId, {
      sourceType: "GOOGLE_MAPS",
      observation: "O perfil mostra 44 avaliações públicas.",
    });

    expect(mocks.evidenceCreate).toHaveBeenCalledTimes(1);
    expect(mocks.leadUpdate).not.toHaveBeenCalled();
    expect(mocks.leadUpdateMany).not.toHaveBeenCalled();
  });

  it("fails with a not-found error before persisting research for a missing lead", async () => {
    leadExists = false;

    await expect(addLeadEvidence(leadId, { sourceType: "WEBSITE", observation: "Observação válida." })).rejects.toBeInstanceOf(ServiceNotFoundError);
    await expect(upsertLeadAnalysis(leadId, { summary: "Leitura válida.", confidence: "LOW" })).rejects.toBeInstanceOf(ServiceNotFoundError);
    expect(mocks.evidenceCreate).not.toHaveBeenCalled();
    expect(mocks.analysisUpsert).not.toHaveBeenCalled();
  });

  it("upserts one analysis per lead and leaves operational lead fields unchanged", async () => {
    const first = await upsertLeadAnalysis(leadId, {
      summary: "A presença digital parece incompleta.",
      confidence: "MEDIUM",
    });
    const second = await upsertLeadAnalysis(leadId, {
      opportunity: "Uma landing page pode reduzir atrito no pedido de orçamento.",
      confidence: "HIGH",
    });

    expect(first).toMatchObject({ id: "analysis-1", confidence: "MEDIUM" });
    expect(second).toMatchObject({ id: "analysis-1", confidence: "HIGH", opportunity: expect.any(String) });
    expect(mocks.analysisUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.leadUpdate).not.toHaveBeenCalled();
    expect(mocks.leadUpdateMany).not.toHaveBeenCalled();
  });

  it("returns bounded research with evidence metadata and the single active analysis", async () => {
    const research = await getLeadResearch(leadId);

    expect(research).toEqual({
      evidences: [{ id: "evidence-new" }],
      analysis: null,
      evidenceTotal: 1,
      evidenceReturned: 1,
      evidenceTruncated: false,
    });
    expect(mocks.leadFindUnique).toHaveBeenLastCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        evidences: expect.objectContaining({ orderBy: { observedAt: "desc" }, take: 20 }),
        analysis: expect.anything(),
        _count: { select: { evidences: true } },
      }),
    }));
  });
});
