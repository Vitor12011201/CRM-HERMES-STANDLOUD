import type { LeadStatus } from "@/generated/prisma/enums";
import { isContactedLead, reachedFunnelStage } from "./lead";

export type FunnelLead = { status: LeadStatus; lastContactAt: Date | null };

export function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

export function getFunnelMetrics(leads: FunnelLead[]) {
  const contacted = leads.filter((lead) => isContactedLead(lead.status, lead.lastContactAt)).length;
  const replied = leads.filter((lead) => reachedFunnelStage(lead.status, "REPLIED", lead.lastContactAt)).length;
  const interested = leads.filter((lead) => reachedFunnelStage(lead.status, "INTERESTED", lead.lastContactAt)).length;
  const proposals = leads.filter((lead) => reachedFunnelStage(lead.status, "PROPOSAL_SENT", lead.lastContactAt)).length;
  const won = leads.filter((lead) => lead.status === "WON").length;
  return {
    contacted,
    replied,
    interested,
    proposals,
    won,
    responseRate: rate(replied, contacted),
    interestRate: rate(interested, contacted),
    proposalRate: rate(proposals, contacted),
    conversionRate: rate(won, contacted),
  };
}
