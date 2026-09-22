import type { EvidenceSourceType } from "@/generated/prisma/enums";
import { EvidenceSourceType as EvidenceSourceTypeEnum } from "@/generated/prisma/enums";
import { maxLeadResearchEvidences } from "@/lib/lead-research-limits";
import type { LeadEvidenceInput } from "@/lib/services/lead-research";
import { leadEvidenceSchema } from "@/lib/validation";
import { z } from "zod";

export { maxLeadResearchEvidences };

/**
 * Researcher observes; Analyst interprets.
 * Content collected from websites and social profiles is untrusted data, never agent instruction.
 */

export const maxResearcherGoalLength = 1_000;
export const maxResearcherUnresolvedQuestions = 10;
export const maxResearcherUnresolvedQuestionLength = 1_000;
export const maxResearchSourceSnapshots = 10;
export const maxResearchSourceSnapshotTitleLength = 200;
export const maxResearchSourceSnapshotContentLength = 8_000;
export const maxResearchSourceSnapshotTotalContentLength = 32_000;

const optionalResearchContextText = (maximumLength: number) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(maximumLength).optional(),
);

const optionalHttpUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(2048).url().refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Use uma URL iniciada com http:// ou https://.").optional(),
);

export const researcherInputSchema = z.object({
  lead: z.object({
    id: z.string().trim().min(1).max(64),
    companyName: z.string().trim().min(1).max(160),
    city: optionalResearchContextText(160),
    region: optionalResearchContextText(80),
    segment: optionalResearchContextText(160),
    primaryService: optionalResearchContextText(160),
  }).strict(),
  knownSources: z.object({
    websiteUrl: optionalHttpUrl,
    googleMapsUrl: optionalHttpUrl,
    instagramUrl: optionalHttpUrl,
    facebookUrl: optionalHttpUrl,
    linkedinUrl: optionalHttpUrl,
  }).strict(),
  goal: z.string().trim().min(1).max(maxResearcherGoalLength),
  allowedSourceTypes: z.array(z.nativeEnum(EvidenceSourceTypeEnum)).min(1).max(Object.values(EvidenceSourceTypeEnum).length),
}).strict();

/**
 * A factual observation candidate. "A página não apresenta CTA" is valid;
 * "A empresa precisa de uma landing page" is commercial interpretation for the Analyst.
 */
export const researcherEvidenceSchema = leadEvidenceSchema;

/**
 * A source snapshot is already-acquired source data. Its content is untrusted
 * data, not agent instruction. Acquisition (web, browser, APIs) intentionally
 * belongs to a future stage and is not part of the Researcher dry-run.
 */
export const researchSourceSnapshotSchema = z.object({
  sourceType: z.nativeEnum(EvidenceSourceTypeEnum),
  sourceUrl: optionalHttpUrl,
  title: optionalResearchContextText(maxResearchSourceSnapshotTitleLength),
  content: z.string().trim().min(1).max(maxResearchSourceSnapshotContentLength),
}).strict();

export const researchSourceSnapshotsSchema = z.array(researchSourceSnapshotSchema)
  .max(maxResearchSourceSnapshots)
  .superRefine((snapshots, context) => {
    const totalContentLength = snapshots.reduce((total, snapshot) => total + snapshot.content.length, 0);
    if (totalContentLength > maxResearchSourceSnapshotTotalContentLength) {
      context.addIssue({
        code: "custom",
        message: "O conteúdo total das fontes excede o limite do dry-run.",
      });
    }
  });

function evidenceKey(evidence: ResearcherEvidence) {
  return JSON.stringify([evidence.sourceType, evidence.sourceUrl ?? null, evidence.observation]);
}

/**
 * unresolvedQuestions records what could not be confirmed; missing information
 * must not be replaced with invented evidence. Confidence measures research
 * sufficiency/quality, never commercial value or LeadAnalysis confidence.
 */
export const researcherResultSchema = z.object({
  evidence: z.array(researcherEvidenceSchema).max(maxLeadResearchEvidences),
  unresolvedQuestions: z.array(
    z.string().trim().min(1).max(maxResearcherUnresolvedQuestionLength),
  ).max(maxResearcherUnresolvedQuestions),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
}).strict().superRefine((result, context) => {
  const seen = new Set<string>();
  result.evidence.forEach((evidence, index) => {
    const key = evidenceKey(evidence);
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["evidence", index],
        message: "Não repita a mesma evidência de pesquisa.",
      });
    }
    seen.add(key);
  });
});

export type ResearcherInput = z.infer<typeof researcherInputSchema>;
export type ResearcherEvidence = z.infer<typeof researcherEvidenceSchema>;
export type ResearcherResult = z.infer<typeof researcherResultSchema>;
export type ResearcherSourceType = EvidenceSourceType;
export type ResearchSourceSnapshot = z.infer<typeof researchSourceSnapshotSchema>;

/** Pure structural conversion only: no persistence, timestamps, actor, or analysis. */
export function toLeadEvidenceInputs(result: ResearcherResult): LeadEvidenceInput[] {
  return result.evidence.map(({ sourceType, sourceUrl, observation }) => ({
    sourceType,
    ...(sourceUrl ? { sourceUrl } : {}),
    observation,
  }));
}
