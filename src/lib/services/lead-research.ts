import type { Prisma } from "@/generated/prisma/client";
import type { AgentActor, AnalysisConfidence, EvidenceSourceType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { maxLeadResearchEvidences } from "@/lib/lead-research-limits";
import { leadAnalysisSchema, leadEvidenceSchema } from "@/lib/validation";
import { ServiceNotFoundError } from "./errors";

export { maxLeadResearchEvidences };

export type LeadEvidenceInput = {
  sourceType: EvidenceSourceType;
  sourceUrl?: string;
  observation: string;
  /** Internal imports may preserve the timestamp at which the fact was observed. */
  observedAt?: Date;
};

export type LeadAnalysisInput = {
  summary?: string;
  opportunity?: string;
  commercialSignals?: string;
  demoConcept?: string;
  confidence: AnalysisConfidence;
};

/**
 * The shared, bounded research shape for both CRM services and MCP reads.
 * Evidence stays factual and separate from the commercial interpretation.
 */
export const leadResearchSelection = {
  evidences: {
    select: {
      id: true,
      sourceType: true,
      sourceUrl: true,
      observation: true,
      observedAt: true,
      capturedBy: true,
    },
    orderBy: { observedAt: "desc" },
    take: maxLeadResearchEvidences,
  },
  analysis: {
    select: {
      summary: true,
      opportunity: true,
      commercialSignals: true,
      demoConcept: true,
      confidence: true,
      updatedBy: true,
      updatedAt: true,
    },
  },
  _count: { select: { evidences: true } },
} as const satisfies Prisma.LeadSelect;

type LeadResearchSelectionResult = Prisma.LeadGetPayload<{ select: typeof leadResearchSelection }>;

export function toLeadResearchOutput(research: LeadResearchSelectionResult) {
  const evidenceTotal = research._count.evidences;
  const evidenceReturned = research.evidences.length;

  return {
    evidences: research.evidences,
    analysis: research.analysis,
    evidenceTotal,
    evidenceReturned,
    evidenceTruncated: evidenceTotal > evidenceReturned,
  };
}

async function requireLead(leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new ServiceNotFoundError("Lead");
  return lead;
}

export async function addLeadEvidence(
  leadId: string,
  input: LeadEvidenceInput,
  options: { capturedBy?: AgentActor } = {},
) {
  const { observedAt, ...evidenceInput } = input;
  const parsed = leadEvidenceSchema.parse(evidenceInput);
  await requireLead(leadId);
  return db.leadEvidence.create({
    data: {
      leadId,
      sourceType: parsed.sourceType,
      ...(parsed.sourceUrl ? { sourceUrl: parsed.sourceUrl } : {}),
      observation: parsed.observation,
      observedAt: observedAt ?? new Date(),
      capturedBy: options.capturedBy ?? "USER",
    },
  });
}

export async function upsertLeadAnalysis(
  leadId: string,
  input: LeadAnalysisInput,
  options: { updatedBy?: AgentActor } = {},
) {
  const parsed = leadAnalysisSchema.parse(input);
  await requireLead(leadId);
  const data = {
    summary: parsed.summary ?? null,
    opportunity: parsed.opportunity ?? null,
    commercialSignals: parsed.commercialSignals ?? null,
    demoConcept: parsed.demoConcept ?? null,
    confidence: parsed.confidence,
    updatedBy: options.updatedBy ?? "USER",
  };
  return db.leadAnalysis.upsert({
    where: { leadId },
    create: { leadId, ...data },
    update: data,
  });
}

export async function getLeadResearch(leadId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: leadResearchSelection,
  });
  if (!lead) throw new ServiceNotFoundError("Lead");
  return toLeadResearchOutput(lead);
}
