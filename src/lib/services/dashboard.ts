import type { LeadStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getFunnelMetrics } from "@/lib/dashboard";
import { getUtcDayBounds } from "@/lib/format";
import { getLeadClassification, leadStatuses } from "@/lib/lead";

export type DueFollowUpOptions = {
  includeUpcoming: boolean;
  limit: number;
};

function summarizePipeline(leads: Array<{ status: LeadStatus; lastContactAt: Date | null; qualificationScore: number }>) {
  const metrics = getFunnelMetrics(leads);
  const byStatus = Object.fromEntries(leadStatuses.map((status) => [status, 0])) as Record<LeadStatus, number>;
  for (const lead of leads) byStatus[lead.status] += 1;

  return {
    totalLeads: leads.length,
    classifications: {
      A: leads.filter((lead) => getLeadClassification(lead.qualificationScore) === "A").length,
      B: leads.filter((lead) => getLeadClassification(lead.qualificationScore) === "B").length,
      C: leads.filter((lead) => getLeadClassification(lead.qualificationScore) === "C").length,
    },
    byStatus,
    contacted: metrics.contacted,
    replied: metrics.replied,
    interested: metrics.interested,
    proposals: metrics.proposals,
    won: metrics.won,
    lost: byStatus.LOST,
    rates: {
      response: metrics.responseRate,
      interest: metrics.interestRate,
      proposal: metrics.proposalRate,
      conversion: metrics.conversionRate,
    },
  };
}

export async function getPipelineSummary() {
  const leads = await db.lead.findMany({
    select: {
      status: true,
      lastContactAt: true,
      qualificationScore: true,
    },
  });
  return summarizePipeline(leads);
}

const followUpSelect = {
  id: true,
  companyName: true,
  city: true,
  status: true,
  nextFollowUpAt: true,
} as const;

export async function getDueFollowUps(options: DueFollowUpOptions) {
  const { start, end } = getUtcDayBounds();
  const [overdue, today, upcoming] = await Promise.all([
    db.lead.findMany({
      where: { nextFollowUpAt: { lt: start } },
      orderBy: { nextFollowUpAt: "asc" },
      take: options.limit,
      select: followUpSelect,
    }),
    db.lead.findMany({
      where: { nextFollowUpAt: { gte: start, lte: end } },
      orderBy: { nextFollowUpAt: "asc" },
      take: options.limit,
      select: followUpSelect,
    }),
    options.includeUpcoming
      ? db.lead.findMany({
        where: { nextFollowUpAt: { gt: end } },
        orderBy: { nextFollowUpAt: "asc" },
        take: options.limit,
        select: followUpSelect,
      })
      : Promise.resolve([]),
  ]);
  return { overdue, today, upcoming };
}
