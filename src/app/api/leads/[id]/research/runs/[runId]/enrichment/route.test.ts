import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getLeadEnrichmentSuggestions: vi.fn(),
  applyLeadEnrichment: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/lead-enrichment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/lead-enrichment")>();
  return {
    ...actual,
    getLeadEnrichmentSuggestions: mocks.getLeadEnrichmentSuggestions,
    applyLeadEnrichment: mocks.applyLeadEnrichment,
  };
});

import { GET, POST } from "./route";

const params = Promise.resolve({ id: "lead-a", runId: "run-a" });

function request(method: "GET" | "POST", body?: unknown) {
  return new Request("https://crm.test/api/leads/lead-a/research/runs/run-a/enrichment", {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

describe("lead enrichment API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.getLeadEnrichmentSuggestions.mockResolvedValue([{ id: "suggestion-a", field: "EMAIL", value: "contato@example.com.br" }]);
    mocks.applyLeadEnrichment.mockResolvedValue({ leadId: "lead-a", runId: "run-a", fields: [] });
  });

  it("requires a session before reading or applying enrichment", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect((await GET(request("GET"), { params })).status).toBe(401);
    expect((await POST(request("POST", { suggestionIds: ["suggestion-a"] }), { params })).status).toBe(401);
    expect(mocks.getLeadEnrichmentSuggestions).not.toHaveBeenCalled();
    expect(mocks.applyLeadEnrichment).not.toHaveBeenCalled();
  });

  it("uses route identifiers and accepts only suggestion IDs", async () => {
    const getResponse = await GET(request("GET"), { params });
    expect(getResponse.status).toBe(200);
    expect(mocks.getLeadEnrichmentSuggestions).toHaveBeenCalledWith("lead-a", "run-a");

    const postResponse = await POST(request("POST", { suggestionIds: ["suggestion-a"] }), { params });
    expect(postResponse.status).toBe(200);
    expect(mocks.applyLeadEnrichment).toHaveBeenCalledWith("lead-a", "run-a", { suggestionIds: ["suggestion-a"] });
  });

  it("rejects browser values, fields, evidence and source URLs", async () => {
    const response = await POST(request("POST", {
      suggestionIds: ["suggestion-a"],
      email: "attacker@example.com",
      phone: "(12) 99999-9999",
      whatsapp: "(12) 99999-9999",
      field: "EMAIL",
      evidence: { observation: "invented" },
      sourceUrl: "https://attacker.test",
    }), { params });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "LEAD_ENRICHMENT_INPUT_INVALID" });
    expect(mocks.applyLeadEnrichment).not.toHaveBeenCalled();
  });

  it("maps cross-lead and approved-state failures without raw internals", async () => {
    const actual = await import("@/lib/lead-enrichment");
    mocks.getLeadEnrichmentSuggestions.mockRejectedValueOnce(new actual.LeadEnrichmentError("RESEARCH_RUN_NOT_FOUND"));
    mocks.applyLeadEnrichment.mockRejectedValueOnce(new actual.LeadEnrichmentError("LEAD_ENRICHMENT_RUN_NOT_APPROVED"));
    expect((await GET(request("GET"), { params })).status).toBe(404);
    const response = await POST(request("POST", { suggestionIds: ["suggestion-a"] }), { params });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "LEAD_ENRICHMENT_RUN_NOT_APPROVED" });
  });
});
