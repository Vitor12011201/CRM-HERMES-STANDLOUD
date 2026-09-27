import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getResearcherRuntimeStatus: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/agent-runtime-status", () => ({ getResearcherRuntimeStatus: mocks.getResearcherRuntimeStatus }));

import { GET } from "./route";

describe("GET /api/agents/researcher/runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.getResearcherRuntimeStatus.mockResolvedValue({
      technicalId: "researcher",
      status: "ONLINE",
      checkedAt: "2026-09-26T00:00:00.000Z",
    });
  });

  it("requires a session before making an upstream runtime check", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getResearcherRuntimeStatus).not.toHaveBeenCalled();
  });

  it("returns only browser-safe runtime status with no-store caching", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      technicalId: "researcher",
      status: "ONLINE",
      checkedAt: "2026-09-26T00:00:00.000Z",
    });
  });
});
