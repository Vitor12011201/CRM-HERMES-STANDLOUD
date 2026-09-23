import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  createLead: vi.fn(),
}));

vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/services/leads", () => ({ createLead: mocks.createLead }));

import { POST } from "./route";

const validLead = {
  companyName: "Atlas Contabilidade",
  qualificationScore: 0,
  status: "NEW",
};

function request(body: unknown) {
  return new Request("https://crm.test/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("lead creation endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.createLead.mockResolvedValue({ id: "lead-1", ...validLead });
  });

  it("requires the authenticated web session before calling the service", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "Sessão inválida." }, { status: 401 }));

    const response = await POST(request(validLead));

    expect(response.status).toBe(401);
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it("keeps validation behavior and delegates valid creation to createLead", async () => {
    const response = await POST(request(validLead));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ lead: { id: "lead-1", ...validLead } });
    expect(mocks.createLead).toHaveBeenCalledWith(validLead);
  });

  it("rejects invalid payloads without calling createLead", async () => {
    const response = await POST(request({ ...validLead, qualificationScore: 11 }));

    expect(response.status).toBe(400);
    expect(mocks.createLead).not.toHaveBeenCalled();
  });
});
