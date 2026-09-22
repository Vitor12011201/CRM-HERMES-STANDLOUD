import type { LeadStatus } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { getFunnelMetrics } from "@/lib/dashboard";
import { getFollowUpTiming } from "@/lib/business-time";
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
  const db = getDb();
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

export async function getDueFollowUps(options: DueFollowUpOptions, reference = new Date()) {
  const db = getDb();
  const followUps = await db.lead.findMany({
    where: { nextFollowUpAt: { not: null } },
    orderBy: { nextFollowUpAt: "asc" },
    select: followUpSelect,
  });
  const overdue = followUps.filter((lead) => getFollowUpTiming(lead.nextFollowUpAt!, reference) === "OVERDUE").slice(0, options.limit);
  const today = followUps.filter((lead) => getFollowUpTiming(lead.nextFollowUpAt!, reference) === "TODAY").slice(0, options.limit);
  const upcoming = options.includeUpcoming
    ? followUps.filter((lead) => getFollowUpTiming(lead.nextFollowUpAt!, reference) === "UPCOMING").slice(0, options.limit)
    : [];
  return { overdue, today, upcoming };
}
