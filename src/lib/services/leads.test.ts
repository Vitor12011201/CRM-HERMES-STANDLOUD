import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  leadFindUnique: vi.fn(),
  leadUpdate: vi.fn(),
  leadUpdateMany: vi.fn(),
  leadActivityCreate: vi.fn(),
  transaction: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));

const database = {
  lead: {
    findUnique: mocks.leadFindUnique,
    update: mocks.leadUpdate,
    updateMany: mocks.leadUpdateMany,
  },
  leadActivity: { create: mocks.leadActivityCreate },
  $transaction: mocks.transaction,
};

import { addLeadActivity, getLeadDetail, setLeadStatus } from "./leads";

const leadId = "lead-1";
let current: { id: string; status: "NEW" | "CONTACTED" | "REPLIED"; lastContactAt: Date | null };
let activityNumber: number;
let detailLead: Record<string, unknown> | null;

function createDetailLead(overrides: Record<string, unknown> = {}) {
  return {
    id: leadId,
    companyName: "Lead de pesquisa",
    qualificationScore: 8,
    status: "CONTACTED",
    activities: [{ id: "activity-1", type: "NOTE", note: "Atividade recente" }],
    evidences: [],
    analysis: null,
    _count: { evidences: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  current = { id: leadId, status: "NEW", lastContactAt: null };
  activityNumber = 0;
  detailLead = null;
  mocks.leadFindUnique.mockImplementation(async (args: { include?: unknown }) => (
    args.include ? detailLead : { ...current }
  ));
  mocks.leadUpdate.mockImplementation(async ({ data }) => {
    current = { ...current, ...data };
    return { ...current };
  });
  mocks.leadUpdateMany.mockImplementation(async ({ where, data }) => {
    const candidate = data.lastContactAt as Date;
    const canAdvance = where.id === leadId
      && (!current.lastContactAt || current.lastContactAt < candidate);
    if (canAdvance) current.lastContactAt = candidate;
    return { count: canAdvance ? 1 : 0 };
  });
  mocks.leadActivityCreate.mockImplementation(async ({ data }) => ({ id: `activity-${++activityNumber}`, ...data }));
  mocks.transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
  mocks.getDb.mockReturnValue(database);
});

describe("lead activity contact consistency", () => {
  it("sets lastContactAt when a CONTACT is recorded for a lead without contact history", async () => {
    const contactAt = new Date("2026-09-21T15:00:00.000Z");

    await addLeadActivity(leadId, { type: "CONTACT", note: "Contato", createdAt: contactAt });

    expect(current.lastContactAt).toEqual(contactAt);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.leadUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastContactAt: contactAt },
      where: expect.objectContaining({ id: leadId }),
    }));
  });

  it("advances lastContactAt when a newer CONTACT is recorded", async () => {
    const previousContactAt = new Date("2026-09-18T12:00:00.000Z");
    const contactAt = new Date("2026-09-21T15:00:00.000Z");
    current.lastContactAt = previousContactAt;

    await addLeadActivity(leadId, { type: "CONTACT", note: "Contato", createdAt: contactAt });

    expect(current.lastContactAt).toEqual(contactAt);
  });

  it("does not let an older CONTACT regress lastContactAt", async () => {
    const contactAt = new Date("2026-09-18T12:00:00.000Z");
    const latestContactAt = new Date("2026-09-21T15:00:00.000Z");
    current.lastContactAt = latestContactAt;

    await addLeadActivity(leadId, { type: "CONTACT", note: "Contato antigo", createdAt: contactAt });

    expect(current.lastContactAt).toEqual(latestContactAt);
    expect(mocks.leadActivityCreate).toHaveBeenCalledTimes(1);
  });

  it("sets lastContactAt when a REPLY is recorded", async () => {
    const replyAt = new Date("2026-09-21T16:00:00.000Z");

    await addLeadActivity(leadId, { type: "REPLY", note: "Resposta", createdAt: replyAt });

    expect(current.lastContactAt).toEqual(replyAt);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it.each(["NOTE", "STATUS_CHANGE"] as const)("does not update lastContactAt for %s activities", async (type) => {
    const latestContactAt = new Date("2026-09-21T15:00:00.000Z");
    current.lastContactAt = latestContactAt;

    await addLeadActivity(leadId, { type, note: "Registro administrativo", createdAt: new Date("2026-09-22T12:00:00.000Z") });

    expect(current.lastContactAt).toEqual(latestContactAt);
    expect(mocks.leadUpdateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["CONTACTED", "REPLIED"] as const)("changes status to %s without treating it as a contact event", async (status) => {
    const latestContactAt = new Date("2026-09-21T15:00:00.000Z");
    current.lastContactAt = latestContactAt;

    const outcome = await setLeadStatus(leadId, status);

    expect(outcome.result).toEqual({ status, changed: true });
    expect(current.status).toBe(status);
    expect(current.lastContactAt).toEqual(latestContactAt);
    expect(mocks.leadActivityCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "STATUS_CHANGE" }),
    }));
    expect(mocks.leadUpdateMany).not.toHaveBeenCalled();
  });
});

describe("lead detail research context", () => {
  it("returns an explicit empty research state", async () => {
    detailLead = createDetailLead();

    const detail = await getLeadDetail(leadId);

    expect(detail?.research).toEqual({
      evidences: [],
      analysis: null,
      evidenceTotal: 0,
      evidenceReturned: 0,
      evidenceTruncated: false,
    });
    expect(detail?.activities).toEqual([{ id: "activity-1", type: "NOTE", note: "Atividade recente" }]);
  });

  it("returns bounded evidence in observedAt descending order with only agent-useful fields", async () => {
    const newest = {
      id: "evidence-new",
      sourceType: "WEBSITE",
      sourceUrl: "https://empresa.example",
      observation: "O site tem formulario de contato.",
      observedAt: new Date("2026-09-21T15:00:00.000Z"),
      capturedBy: "USER",
    };
    const older = {
      id: "evidence-old",
      sourceType: "GOOGLE_MAPS",
      sourceUrl: null,
      observation: "O perfil mostra avaliacoes publicas.",
      observedAt: new Date("2026-09-20T15:00:00.000Z"),
      capturedBy: "AGENT",
    };
    detailLead = createDetailLead({ evidences: [newest, older], _count: { evidences: 2 } });

    const detail = await getLeadDetail(leadId);

    expect(detail?.research.evidences).toEqual([newest, older]);
    expect(mocks.leadFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        evidences: expect.objectContaining({ orderBy: { observedAt: "desc" }, take: 20 }),
      }),
    }));
  });

  it("returns analysis separately from evidence without changing commercial lead fields", async () => {
    const analysis = {
      summary: "A presenca digital parece incompleta.",
      opportunity: "Uma landing page pode reduzir atrito.",
      commercialSignals: "Empresa aparenta operar ativamente.",
      demoConcept: "Demo com CTA de orcamento rapido.",
      confidence: "MEDIUM",
      updatedBy: "USER",
      updatedAt: new Date("2026-09-21T15:00:00.000Z"),
    };
    detailLead = createDetailLead({ analysis });

    const detail = await getLeadDetail(leadId);

    expect(detail?.research.analysis).toEqual(analysis);
    expect(mocks.leadUpdate).not.toHaveBeenCalled();
    expect(mocks.leadUpdateMany).not.toHaveBeenCalled();
  });

  it("returns evidence and analysis together while preserving their structural separation", async () => {
    const evidence = {
      id: "evidence-1",
      sourceType: "INSTAGRAM",
      sourceUrl: "https://instagram.example/empresa",
      observation: "O perfil exibe trabalhos recentes.",
      observedAt: new Date("2026-09-21T14:00:00.000Z"),
      capturedBy: "USER",
    };
    const analysis = {
      summary: "Ha atividade recente em canal social.",
      opportunity: null,
      commercialSignals: null,
      demoConcept: null,
      confidence: "LOW",
      updatedBy: "USER",
      updatedAt: new Date("2026-09-21T15:00:00.000Z"),
    };
    detailLead = createDetailLead({ evidences: [evidence], analysis, _count: { evidences: 1 } });

    const detail = await getLeadDetail(leadId);

    expect(detail?.research).toMatchObject({
      evidences: [evidence],
      analysis,
      evidenceTotal: 1,
      evidenceReturned: 1,
      evidenceTruncated: false,
    });
  });

  it("reports total and truncation when evidence exceeds the bounded payload", async () => {
    const evidences = Array.from({ length: 20 }, (_, index) => ({
      id: `evidence-${index}`,
      sourceType: "OTHER",
      sourceUrl: null,
      observation: `Observacao ${index}`,
      observedAt: new Date(`2026-09-${String(20 - index).padStart(2, "0")}T12:00:00.000Z`),
      capturedBy: "USER",
    }));
    detailLead = createDetailLead({ evidences, _count: { evidences: 21 } });

    const detail = await getLeadDetail(leadId);

    expect(detail?.research).toMatchObject({
      evidenceTotal: 21,
      evidenceReturned: 20,
      evidenceTruncated: true,
    });
    expect(detail?.research.evidences).toHaveLength(20);
  });

  it("preserves the null result for a nonexistent lead", async () => {
    detailLead = null;

    await expect(getLeadDetail(leadId)).resolves.toBeNull();
  });

  it("uses one request-scoped client throughout a multi-query status change", async () => {
    await setLeadStatus(leadId, "CONTACTED");

    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.leadFindUnique).toHaveBeenCalledTimes(2);
    expect(mocks.leadUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.leadActivityCreate).toHaveBeenCalledTimes(1);
  });
});
