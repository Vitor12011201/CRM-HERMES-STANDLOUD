import type { Prisma } from "@/generated/prisma/client";
import { getBusinessCalendarDateKey, getFollowUpTimingForBusinessDate } from "./business-time";
import { getFinancialTotals } from "./finance";
import { getLeadClassification, isContactedLead, reachedFunnelStage } from "./lead";

export const dashboardLeadSelect = {
  id: true,
  companyName: true,
  nextFollowUpAt: true,
  status: true,
  lastContactAt: true,
  qualificationScore: true,
} as const satisfies Prisma.LeadSelect;

export const dashboardProjectSelect = {
  status: true,
  totalAmountCents: true,
  payments: {
    select: {
      amountCents: true,
    },
  },
} as const satisfies Prisma.ProjectSelect;

export type DashboardLead = Prisma.LeadGetPayload<{ select: typeof dashboardLeadSelect }>;
export type DashboardProject = Prisma.ProjectGetPayload<{ select: typeof dashboardProjectSelect }>;
export type FunnelLead = Pick<DashboardLead, "status" | "lastContactAt">;

type FunnelCounts = {
  contacted: number;
  replied: number;
  interested: number;
  proposals: number;
  won: number;
};

function createFunnelCounts(): FunnelCounts {
  return { contacted: 0, replied: 0, interested: 0, proposals: 0, won: 0 };
}

function addFunnelLead(counts: FunnelCounts, lead: FunnelLead) {
  if (isContactedLead(lead.status, lead.lastContactAt)) counts.contacted += 1;
  if (reachedFunnelStage(lead.status, "REPLIED", lead.lastContactAt)) counts.replied += 1;
  if (reachedFunnelStage(lead.status, "INTERESTED", lead.lastContactAt)) counts.interested += 1;
  if (reachedFunnelStage(lead.status, "PROPOSAL_SENT", lead.lastContactAt)) counts.proposals += 1;
  if (lead.status === "WON") counts.won += 1;
}

function metricsFromCounts(counts: FunnelCounts) {
  return {
    ...counts,
    responseRate: rate(counts.replied, counts.contacted),
    interestRate: rate(counts.interested, counts.contacted),
    proposalRate: rate(counts.proposals, counts.interested),
    conversionRate: rate(counts.won, counts.contacted),
  };
}

export function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

export function getFunnelMetrics(leads: FunnelLead[]) {
  const counts = createFunnelCounts();
  for (const lead of leads) addFunnelLead(counts, lead);
  return metricsFromCounts(counts);
}

export function calculateDashboardData(leads: DashboardLead[], projects: DashboardProject[], reference = new Date()) {
  const funnelCounts = createFunnelCounts();
  const scoreCounts = { A: 0, B: 0, C: 0 };
  const overdue: DashboardLead[] = [];
  const today: DashboardLead[] = [];
  const upcoming: DashboardLead[] = [];
  const businessDate = getBusinessCalendarDateKey(reference);
  let lost = 0;

  // The page query orders by nextFollowUpAt, so retaining only the first six
  // UPCOMING rows preserves the previous `filter(...).slice(0, 6)` result.
  for (const lead of leads) {
    addFunnelLead(funnelCounts, lead);

    const classification = getLeadClassification(lead.qualificationScore);
    scoreCounts[classification] += 1;
    if (lead.status === "LOST") lost += 1;

    if (!lead.nextFollowUpAt) continue;
    const timing = getFollowUpTimingForBusinessDate(lead.nextFollowUpAt, businessDate);
    if (timing === "OVERDUE") overdue.push(lead);
    else if (timing === "TODAY") today.push(lead);
    else if (upcoming.length < 6) upcoming.push(lead);
  }

  return {
    metrics: metricsFromCounts(funnelCounts),
    finance: getFinancialTotals(projects, (project) => project.status !== "CANCELLED"),
    scoreCounts,
    lost,
    overdue,
    today,
    upcoming,
  };
}
