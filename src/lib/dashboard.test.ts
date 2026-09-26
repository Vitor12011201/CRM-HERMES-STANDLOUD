import { describe, expect, it } from "vitest";
import { getFollowUpTiming } from "./business-time";
import {
  calculateDashboardData,
  dashboardLeadSelect,
  dashboardProjectSelect,
  getFunnelMetrics,
  type DashboardLead,
  type DashboardProject,
} from "./dashboard";
import { getFinancialTotals } from "./finance";
import { getLeadClassification, isContactedLead, reachedFunnelStage } from "./lead";

function lead(
  id: string,
  status: DashboardLead["status"],
  qualificationScore: number,
  lastContactAt: Date | null,
  nextFollowUpAt: Date | null,
): DashboardLead {
  return {
    id,
    companyName: `Company ${id}`,
    status,
    qualificationScore,
    lastContactAt,
    nextFollowUpAt,
  };
}

function legacyDashboardCalculation(leads: DashboardLead[], projects: DashboardProject[], reference: Date) {
  const contacted = leads.filter((item) => isContactedLead(item.status, item.lastContactAt)).length;
  const replied = leads.filter((item) => reachedFunnelStage(item.status, "REPLIED", item.lastContactAt)).length;
  const interested = leads.filter((item) => reachedFunnelStage(item.status, "INTERESTED", item.lastContactAt)).length;
  const proposals = leads.filter((item) => reachedFunnelStage(item.status, "PROPOSAL_SENT", item.lastContactAt)).length;
  const won = leads.filter((item) => item.status === "WON").length;
  const followUps = leads.filter((item) => item.nextFollowUpAt);

  return {
    metrics: {
      contacted,
      replied,
      interested,
      proposals,
      won,
      responseRate: contacted === 0 ? null : (replied / contacted) * 100,
      interestRate: contacted === 0 ? null : (interested / contacted) * 100,
      proposalRate: interested === 0 ? null : (proposals / interested) * 100,
      conversionRate: contacted === 0 ? null : (won / contacted) * 100,
    },
    finance: getFinancialTotals(projects.filter((project) => project.status !== "CANCELLED")),
    scoreCounts: {
      A: leads.filter((item) => getLeadClassification(item.qualificationScore) === "A").length,
      B: leads.filter((item) => getLeadClassification(item.qualificationScore) === "B").length,
      C: leads.filter((item) => getLeadClassification(item.qualificationScore) === "C").length,
    },
    lost: leads.filter((item) => item.status === "LOST").length,
    overdue: followUps.filter((item) => getFollowUpTiming(item.nextFollowUpAt!, reference) === "OVERDUE"),
    today: followUps.filter((item) => getFollowUpTiming(item.nextFollowUpAt!, reference) === "TODAY"),
    upcoming: followUps.filter((item) => getFollowUpTiming(item.nextFollowUpAt!, reference) === "UPCOMING").slice(0, 6),
  };
}

describe("funnel metrics", () => {
  it("counts leads that advanced in the funnel as having reached prior stages", () => {
    const metrics = getFunnelMetrics([
      { status: "CONTACTED", lastContactAt: new Date() },
      { status: "PROPOSAL_SENT", lastContactAt: new Date() },
      { status: "WON", lastContactAt: new Date() },
      { status: "LOST", lastContactAt: new Date() },
    ]);
    expect(metrics.contacted).toBe(4);
    expect(metrics.replied).toBe(2);
    expect(metrics.interested).toBe(2);
    expect(metrics.proposals).toBe(2);
    expect(metrics.won).toBe(1);
    expect(metrics.conversionRate).toBe(25);
  });

  it("returns no rate when there are no contacted leads", () => {
    expect(getFunnelMetrics([{ status: "NEW", lastContactAt: null }]).responseRate).toBeNull();
  });
});

describe("dashboard calculation", () => {
  const reference = new Date("2026-05-15T12:00:00.000Z");
  const contactedAt = new Date("2026-05-01T12:00:00.000Z");
  const leads = [
    lead("new", "NEW", 0, null, null),
    lead("contacted", "CONTACTED", 5, contactedAt, new Date("2026-05-14T00:00:00.000Z")),
    lead("replied", "REPLIED", 8, contactedAt, new Date("2026-05-15T00:00:00.000Z")),
    lead("interested", "INTERESTED", 4, contactedAt, new Date("2026-05-16T00:00:00.000Z")),
    lead("proposal", "PROPOSAL_SENT", 6, contactedAt, new Date("2026-05-17T00:00:00.000Z")),
    lead("won", "WON", 9, contactedAt, new Date("2026-05-18T00:00:00.000Z")),
    lead("lost-contacted", "LOST", 2, contactedAt, new Date("2026-05-19T00:00:00.000Z")),
    lead("lost-uncontacted", "LOST", 3, null, new Date("2026-05-20T00:00:00.000Z")),
    lead("upcoming-6", "QUALIFIED", 5, null, new Date("2026-05-21T00:00:00.000Z")),
    lead("upcoming-7", "NEW", 0, null, new Date("2026-05-22T00:00:00.000Z")),
  ];
  const projects: DashboardProject[] = [
    { status: "ACTIVE", totalAmountCents: 100_000, payments: [{ amountCents: 25_000 }, { amountCents: 25_000 }] },
    { status: "COMPLETED", totalAmountCents: 60_000, payments: [{ amountCents: 60_000 }] },
    { status: "CANCELLED", totalAmountCents: 999_000, payments: [{ amountCents: 999_000 }] },
  ];

  it("is equivalent to the prior filter-based dashboard calculation", () => {
    expect(calculateDashboardData(leads, projects, reference)).toEqual(legacyDashboardCalculation(leads, projects, reference));
  });

  it("keeps only the columns used by the dashboard queries", () => {
    expect(dashboardLeadSelect).toEqual({
      id: true,
      companyName: true,
      nextFollowUpAt: true,
      status: true,
      lastContactAt: true,
      qualificationScore: true,
    });
    expect(dashboardProjectSelect).toEqual({
      status: true,
      totalAmountCents: true,
      payments: { select: { amountCents: true } },
    });
  });
});
