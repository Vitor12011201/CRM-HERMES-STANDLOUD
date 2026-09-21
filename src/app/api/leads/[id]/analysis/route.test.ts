import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceNotFoundError } from "@/lib/services/errors";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  upsertLeadAnalysis: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/services/lead-research", () => ({ upsertLeadAnalysis: mocks.upsertLeadAnalysis }));

import { PUT } from "./route";

const leadId = "lead-1";
const validPayload = { summary: "A presença digital parece incompleta.", confidence: "MEDIUM" };

function request(body: unknown) {
  return new Request("https://crm.test/api/leads/lead-1/analysis", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("lead analysis endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.upsertLeadAnalysis.mockResolvedValue({ id: "analysis-1", ...validPayload, updatedBy: "USER" });
  });

  it("requires an authenticated web session", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "Sessão inválida." }, { status: 401 }));
    const response = await PUT(request(validPayload), { params: Promise.resolve({ id: leadId }) });

    expect(response.status).toBe(401);
    expect(mocks.upsertLeadAnalysis).not.toHaveBeenCalled();
  });

  it("rejects an empty analysis, invalid confidence, and browser-selected update actors", async () => {
    const empty = await PUT(request({ confidence: "MEDIUM" }), { params: Promise.resolve({ id: leadId }) });
    const invalid = await PUT(request({ summary: "Leitura", confidence: "CERTAIN", updatedBy: "AGENT" }), { params: Promise.resolve({ id: leadId }) });

    expect(empty.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(mocks.upsertLeadAnalysis).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing lead", async () => {
    mocks.upsertLeadAnalysis.mockRejectedValue(new ServiceNotFoundError("Lead"));
    const response = await PUT(request(validPayload), { params: Promise.resolve({ id: leadId }) });

    expect(response.status).toBe(404);
  });

  it("upserts analysis with USER set server-side", async () => {
    const response = await PUT(request(validPayload), { params: Promise.resolve({ id: leadId }) });

    expect(response.status).toBe(200);
    expect(mocks.upsertLeadAnalysis).toHaveBeenCalledWith(leadId, validPayload, { updatedBy: "USER" });
  });
});
