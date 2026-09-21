import type { AgentActor, AnalysisConfidence, EvidenceSourceType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { leadAnalysisSchema, leadEvidenceSchema } from "@/lib/validation";
import { ServiceNotFoundError } from "./errors";

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
    select: {
      evidences: { orderBy: { observedAt: "desc" } },
      analysis: true,
    },
  });
  if (!lead) throw new ServiceNotFoundError("Lead");
  return lead;
}
