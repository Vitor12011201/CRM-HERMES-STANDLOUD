import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceNotFoundError } from "@/lib/services/errors";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  addLeadEvidence: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/services/lead-research", () => ({ addLeadEvidence: mocks.addLeadEvidence }));

import { POST } from "./route";

const leadId = "lead-1";
const validPayload = { sourceType: "WEBSITE", sourceUrl: "https://empresa.example", observation: "O site apresenta um formulário de contato." };

function request(body: unknown) {
  return new Request("https://crm.test/api/leads/lead-1/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("lead evidence endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.addLeadEvidence.mockResolvedValue({ id: "evidence-1", ...validPayload, capturedBy: "USER" });
  });

  it("requires an authenticated web session", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "Sessão inválida." }, { status: 401 }));
    const response = await POST(request(validPayload), { params: Promise.resolve({ id: leadId }) });

    expect(response.status).toBe(401);
    expect(mocks.addLeadEvidence).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads and browser-selected capture actors", async () => {
    const response = await POST(request({ ...validPayload, sourceUrl: "javascript:alert(1)", capturedBy: "AGENT" }), { params: Promise.resolve({ id: leadId }) });

    expect(response.status).toBe(400);
    expect(mocks.addLeadEvidence).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing lead", async () => {
    mocks.addLeadEvidence.mockRejectedValue(new ServiceNotFoundError("Lead"));
    const response = await POST(request(validPayload), { params: Promise.resolve({ id: leadId }) });

    expect(response.status).toBe(404);
  });

  it("creates evidence with USER set server-side", async () => {
    const response = await POST(request(validPayload), { params: Promise.resolve({ id: leadId }) });

    expect(response.status).toBe(201);
    expect(mocks.addLeadEvidence).toHaveBeenCalledWith(leadId, validPayload, { capturedBy: "USER" });
  });
});
