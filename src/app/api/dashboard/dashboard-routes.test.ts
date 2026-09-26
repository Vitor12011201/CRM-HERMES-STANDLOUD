import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getDashboardFunnel: vi.fn(),
  getDashboardFollowUps: vi.fn(),
  getDashboardFinance: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth/api", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/dashboard-reads", () => ({
  getDashboardFunnel: mocks.getDashboardFunnel,
  getDashboardFollowUps: mocks.getDashboardFollowUps,
  getDashboardFinance: mocks.getDashboardFinance,
}));

import { GET as funnel } from "./funnel/route";
import { GET as finance } from "./finance/route";
import { GET as followUps } from "./followups/route";

describe("dashboard read APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.getDashboardFunnel.mockResolvedValue({ totalLeads: 3, classA: 1 });
    mocks.getDashboardFollowUps.mockResolvedValue({ overdue: { count: 0, items: [] }, today: { count: 0, items: [] }, upcoming: { count: 0, items: [] } });
    mocks.getDashboardFinance.mockResolvedValue({ contractedCents: 100, receivedCents: 50, outstandingCents: 50 });
  });

  it("requires a session before every D1 dashboard read", async () => {
    mocks.requireApiSession.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect((await funnel()).status).toBe(401);
    expect((await followUps()).status).toBe(401);
    expect((await finance()).status).toBe(401);
    expect(mocks.getDashboardFunnel).not.toHaveBeenCalled();
    expect(mocks.getDashboardFollowUps).not.toHaveBeenCalled();
    expect(mocks.getDashboardFinance).not.toHaveBeenCalled();
  });

  it("returns only each section DTO and no-store headers", async () => {
    const funnelResponse = await funnel();
    const followUpResponse = await followUps();
    const financeResponse = await finance();
    expect(funnelResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(await funnelResponse.json()).toEqual({ totalLeads: 3, classA: 1 });
    expect(await followUpResponse.json()).toEqual({ overdue: { count: 0, items: [] }, today: { count: 0, items: [] }, upcoming: { count: 0, items: [] } });
    expect(await financeResponse.json()).toEqual({ contractedCents: 100, receivedCents: 50, outstandingCents: 50 });
  });

  it("maps individual read failures to sanitized responses", async () => {
    mocks.getDashboardFinance.mockRejectedValueOnce(new Error("D1 internals"));
    const response = await finance();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "DASHBOARD_FINANCE_UNAVAILABLE" });
  });
});
