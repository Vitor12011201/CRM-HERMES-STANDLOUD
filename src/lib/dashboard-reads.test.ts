import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { calculateDashboardData, type DashboardLead, type DashboardProject } from "./dashboard";
import { dashboardReadQueries, getDashboardFinance, getDashboardFollowUps, getDashboardFunnel, type DashboardReadDatabase } from "./dashboard-reads";

function database(firstRow: unknown, rows: unknown[] = []): DashboardReadDatabase {
  return {
    prepare: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(firstRow),
      all: vi.fn().mockResolvedValue({ results: rows }),
    })),
  };
}

describe("dashboard read APIs", () => {
  it("maps the aggregate funnel row to the existing funnel semantics", async () => {
    const leads: DashboardLead[] = [
      { id: "new", companyName: "New", status: "NEW", qualificationScore: 0, lastContactAt: null, nextFollowUpAt: null },
      { id: "contacted", companyName: "Contacted", status: "CONTACTED", qualificationScore: 5, lastContactAt: new Date(), nextFollowUpAt: null },
      { id: "replied", companyName: "Replied", status: "REPLIED", qualificationScore: 8, lastContactAt: new Date(), nextFollowUpAt: null },
      { id: "interested", companyName: "Interested", status: "INTERESTED", qualificationScore: 4, lastContactAt: new Date(), nextFollowUpAt: null },
      { id: "proposal", companyName: "Proposal", status: "PROPOSAL_SENT", qualificationScore: 6, lastContactAt: new Date(), nextFollowUpAt: null },
      { id: "won", companyName: "Won", status: "WON", qualificationScore: 9, lastContactAt: new Date(), nextFollowUpAt: null },
      { id: "lost-contacted", companyName: "Lost contacted", status: "LOST", qualificationScore: 2, lastContactAt: new Date(), nextFollowUpAt: null },
      { id: "lost-uncontacted", companyName: "Lost uncontacted", status: "LOST", qualificationScore: 3, lastContactAt: null, nextFollowUpAt: null },
    ];
    const expected = calculateDashboardData(leads, [] as DashboardProject[]).metrics;
    const result = await getDashboardFunnel(database({
      totalLeads: 8,
      classA: 2,
      classB: 2,
      classC: 4,
      invalidClassificationCount: 0,
      contacted: 6,
      replied: 4,
      interested: 3,
      proposals: 2,
      won: 1,
      lost: 2,
    }));

    expect(result).toEqual({
      totalLeads: leads.length,
      classA: 2,
      classB: 2,
      classC: 4,
      ...expected,
      lost: 2,
    });
  });

  it("preserves business-calendar follow-up timing and limits only upcoming rows", async () => {
    const result = await getDashboardFollowUps(database(null, [
      { id: "overdue", companyName: "Ontem", nextFollowUpAt: "2026-09-20T00:00:00.000Z" },
      { id: "today", companyName: "Hoje", nextFollowUpAt: "2026-09-21T00:00:00.000Z" },
      { id: "upcoming-1", companyName: "Amanhã", nextFollowUpAt: "2026-09-22T00:00:00.000Z" },
      { id: "upcoming-2", companyName: "Depois", nextFollowUpAt: "2026-09-23T00:00:00.000Z" },
      { id: "upcoming-3", companyName: "Depois", nextFollowUpAt: "2026-09-24T00:00:00.000Z" },
      { id: "upcoming-4", companyName: "Depois", nextFollowUpAt: "2026-09-25T00:00:00.000Z" },
      { id: "upcoming-5", companyName: "Depois", nextFollowUpAt: "2026-09-26T00:00:00.000Z" },
      { id: "upcoming-6", companyName: "Depois", nextFollowUpAt: "2026-09-27T00:00:00.000Z" },
      { id: "upcoming-7", companyName: "Depois", nextFollowUpAt: "2026-09-28T00:00:00.000Z" },
    ]), new Date("2026-09-22T00:30:00.000Z"));

    expect(result.overdue.items.map((item) => item.id)).toEqual(["overdue"]);
    expect(result.today.items.map((item) => item.id)).toEqual(["today"]);
    expect(result.upcoming.items.map((item) => item.id)).toEqual(["upcoming-1", "upcoming-2", "upcoming-3", "upcoming-4", "upcoming-5", "upcoming-6"]);
    expect(result).toMatchObject({ overdue: { count: 1 }, today: { count: 1 }, upcoming: { count: 6 } });
  });

  it("returns the existing financial totals while excluding cancelled projects", async () => {
    await expect(getDashboardFinance(database({ contractedCents: 160_000, receivedCents: 110_000 }))).resolves.toEqual({
      contractedCents: 160_000,
      receivedCents: 110_000,
      outstandingCents: 50_000,
    });
  });

  it("uses narrow read-only query shapes with no business fields outside each DTO", () => {
    expect(dashboardReadQueries.funnelQuery).toContain("COUNT(*) AS totalLeads");
    expect(dashboardReadQueries.funnelQuery).not.toContain("SELECT *");
    expect(dashboardReadQueries.followUpsQuery).toMatch(/SELECT id, companyName, nextFollowUpAt/);
    expect(dashboardReadQueries.followUpsQuery).not.toContain("websiteUrl");
    expect(dashboardReadQueries.financeQuery).toContain("SUM(totalAmountCents)");
    expect(dashboardReadQueries.financeQuery).not.toContain("clientName");
  });
});
