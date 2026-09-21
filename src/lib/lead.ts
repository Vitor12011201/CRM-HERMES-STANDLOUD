import type { LeadStatus } from "@/generated/prisma/enums";

export type LeadClassification = "A" | "B" | "C";

export function getLeadClassification(score: number): LeadClassification {
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    throw new RangeError("A pontuação deve ser um número inteiro entre 0 e 10.");
  }
  if (score >= 8) return "A";
  if (score >= 5) return "B";
  return "C";
}

export const leadStatusLabels: Record<LeadStatus, string> = {
  NEW: "Novo",
  QUALIFIED: "Qualificado",
  CONTACTED: "Contatado",
  REPLIED: "Respondeu",
  INTERESTED: "Interessado",
  DEMO_SENT: "Demo enviada",
  MEETING: "Reunião",
  PROPOSAL_SENT: "Proposta enviada",
  WON: "Ganho",
  LOST: "Perdido",
};

export const leadStatuses = Object.keys(leadStatusLabels) as LeadStatus[];

export const leadStatusOrder: Record<LeadStatus, number> = {
  NEW: 0,
  QUALIFIED: 1,
  CONTACTED: 2,
  REPLIED: 3,
  INTERESTED: 4,
  DEMO_SENT: 5,
  MEETING: 6,
  PROPOSAL_SENT: 7,
  WON: 8,
  LOST: -1,
};

/**
 * A lead counts for a funnel stage when it reached that stage or a later
 * non-lost stage. LOST only counts through the last known previous stage,
 * which is not currently persisted; it therefore only counts as contacted
 * after a contact has actually been recorded in lastContactAt.
 */
export function reachedFunnelStage(
  status: LeadStatus,
  stage: Exclude<LeadStatus, "NEW" | "QUALIFIED" | "LOST">,
  lastContactAt?: Date | null,
): boolean {
  if (status === "LOST") return stage === "CONTACTED" && Boolean(lastContactAt);
  return leadStatusOrder[status] >= leadStatusOrder[stage];
}

export function isContactedLead(status: LeadStatus, lastContactAt?: Date | null) {
  return reachedFunnelStage(status, "CONTACTED", lastContactAt);
}
