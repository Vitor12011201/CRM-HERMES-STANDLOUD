import { z } from "zod";

/**
 * Scout discovers; Researcher observes; Analyst interprets.
 * This V0 module is deliberately pure: discovery data enters as input and no
 * model, network, CRM, or persistence capability is available here.
 */

export const maxScoutDiscoveryCandidates = 50;
export const maxScoutExistingLeadReferences = 500;
export const maxScoutTargetLocations = 20;
export const maxScoutTargetSegments = 20;
export const maxScoutBasisItems = 10;
export const maxScoutUnresolvedQuestions = 10;
export const maxScoutDiscoveryIdLength = 128;
export const maxScoutCompanyNameLength = 300;
export const maxScoutLocationLength = 160;
export const maxScoutSegmentLength = 160;
export const maxScoutUrlLength = 2_048;
export const maxScoutBasisLength = 500;
export const maxScoutUnresolvedQuestionLength = 500;

const requiredText = (maximumLength: number) => z.string().trim().min(1).max(maximumLength);

const optionalText = (maximumLength: number) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  requiredText(maximumLength).optional(),
);

const optionalHttpUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(maxScoutUrlLength).url().refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an http(s) URL.").optional(),
);

export const scoutDiscoverySourceTypeSchema = z.enum([
  "GOOGLE_MAPS",
  "WEBSITE",
  "DIRECTORY",
  "FOURSQUARE",
  "OTHER",
]);

export const scoutDiscoverySourceSchema = z.object({
  type: scoutDiscoverySourceTypeSchema,
  url: optionalHttpUrl,
}).strict();

/** A record supplied by a future deterministic discovery provider. */
export const scoutDiscoveryCandidateSchema = z.object({
  discoveryId: requiredText(maxScoutDiscoveryIdLength),
  companyName: requiredText(maxScoutCompanyNameLength),
  city: optionalText(maxScoutLocationLength),
  region: optionalText(maxScoutLocationLength),
  segment: optionalText(maxScoutSegmentLength),
  websiteUrl: optionalHttpUrl,
  source: scoutDiscoverySourceSchema,
}).strict();

/** Minimal existing-Lead context needed only for deterministic duplicate checks. */
export const scoutExistingLeadReferenceSchema = z.object({
  id: requiredText(64),
  companyName: requiredText(maxScoutCompanyNameLength),
  city: optionalText(maxScoutLocationLength),
  region: optionalText(maxScoutLocationLength),
  websiteUrl: optionalHttpUrl,
}).strict();

/** Objective discovery constraints only; no score, commercial judgement, or ranking. */
export const scoutCriteriaSchema = z.object({
  targetLocations: z.array(requiredText(maxScoutLocationLength)).max(maxScoutTargetLocations).optional(),
  targetSegments: z.array(requiredText(maxScoutSegmentLength)).max(maxScoutTargetSegments).optional(),
  requirePublicWebsite: z.boolean().optional(),
  maxCandidatesToInspect: z.number().int().min(1).max(maxScoutDiscoveryCandidates),
}).strict();

export const scoutInputSchema = z.object({
  criteria: scoutCriteriaSchema,
  discoveryCandidates: z.array(scoutDiscoveryCandidateSchema).max(maxScoutDiscoveryCandidates)
    .superRefine((candidates, context) => {
      const seen = new Set<string>();
      candidates.forEach((candidate, index) => {
        if (seen.has(candidate.discoveryId)) {
          context.addIssue({
            code: "custom",
            path: [index, "discoveryId"],
            message: "Discovery IDs must be unique within one Scout run.",
          });
        }
        seen.add(candidate.discoveryId);
      });
    }),
  existingLeadReferences: z.array(scoutExistingLeadReferenceSchema)
    .max(maxScoutExistingLeadReferences),
}).strict();

const scoutBasisSchema = z.array(requiredText(maxScoutBasisLength)).min(1).max(maxScoutBasisItems);
const scoutUnresolvedQuestionsSchema = z.array(
  requiredText(maxScoutUnresolvedQuestionLength),
).max(maxScoutUnresolvedQuestions);

export const scoutFoundResultSchema = z.object({
  outcome: z.literal("FOUND"),
  candidate: scoutDiscoveryCandidateSchema,
  basis: scoutBasisSchema,
  unresolvedQuestions: scoutUnresolvedQuestionsSchema,
}).strict();

export const scoutNoneReasonSchema = z.enum([
  "NO_DISCOVERY_CANDIDATES",
  "NO_ELIGIBLE_CANDIDATE",
]);

export const scoutNoneResultSchema = z.object({
  outcome: z.literal("NONE"),
  reason: scoutNoneReasonSchema,
  unresolvedQuestions: scoutUnresolvedQuestionsSchema,
}).strict();

/** One Scout run yields at most one candidate, or a deterministic absence result. */
export const scoutResultSchema = z.discriminatedUnion("outcome", [
  scoutFoundResultSchema,
  scoutNoneResultSchema,
]);

export type ScoutDiscoverySourceType = z.infer<typeof scoutDiscoverySourceTypeSchema>;
export type ScoutDiscoverySource = z.infer<typeof scoutDiscoverySourceSchema>;
export type ScoutDiscoveryCandidate = z.infer<typeof scoutDiscoveryCandidateSchema>;
export type ScoutExistingLeadReference = z.infer<typeof scoutExistingLeadReferenceSchema>;
export type ScoutCriteria = z.infer<typeof scoutCriteriaSchema>;
export type ScoutInput = z.infer<typeof scoutInputSchema>;
export type ScoutFoundResult = z.infer<typeof scoutFoundResultSchema>;
export type ScoutNoneResult = z.infer<typeof scoutNoneResultSchema>;
export type ScoutResult = z.infer<typeof scoutResultSchema>;

export type ScoutDuplicateAssessment = "EXACT_DUPLICATE" | "AMBIGUOUS" | "DISTINCT";

function normalizeComparableText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

/**
 * Canonicalizes only URL syntax used for exact website comparison: protocol and
 * host casing/default ports are normalized by URL, and fragments are removed.
 * Paths and query strings remain exact, so this is not fuzzy URL matching.
 */
export function normalizeScoutWebsiteUrl(url: string): string {
  const normalized = new URL(url);
  normalized.hash = "";
  return normalized.toString();
}

function hasSameCompleteNameAndLocation(
  candidate: ScoutDiscoveryCandidate,
  existingLead: ScoutExistingLeadReference,
): boolean {
  const candidateName = normalizeComparableText(candidate.companyName);
  const candidateCity = normalizeComparableText(candidate.city);
  const candidateRegion = normalizeComparableText(candidate.region);
  const existingName = normalizeComparableText(existingLead.companyName);
  const existingCity = normalizeComparableText(existingLead.city);
  const existingRegion = normalizeComparableText(existingLead.region);

  return candidateName !== undefined
    && candidateCity !== undefined
    && candidateRegion !== undefined
    && candidateName === existingName
    && candidateCity === existingCity
    && candidateRegion === existingRegion;
}

function hasPotentialNameAndLocationMatch(
  candidate: ScoutDiscoveryCandidate,
  existingLead: ScoutExistingLeadReference,
): boolean {
  const candidateName = normalizeComparableText(candidate.companyName);
  const existingName = normalizeComparableText(existingLead.companyName);
  if (candidateName === undefined || candidateName !== existingName) return false;

  const candidateCity = normalizeComparableText(candidate.city);
  const candidateRegion = normalizeComparableText(candidate.region);
  const existingCity = normalizeComparableText(existingLead.city);
  const existingRegion = normalizeComparableText(existingLead.region);

  const locationIncomplete = candidateCity === undefined
    || candidateRegion === undefined
    || existingCity === undefined
    || existingRegion === undefined;

  return locationIncomplete || (candidateCity === existingCity && candidateRegion === existingRegion);
}

/**
 * Exact duplicate rule: canonical website URLs match when both exist; otherwise
 * both records must lack a website and have the same normalized name, city, and
 * region. Near matches are deliberately ambiguous rather than duplicates.
 */
export function assessScoutDuplicate(
  candidate: ScoutDiscoveryCandidate,
  existingLead: ScoutExistingLeadReference,
): ScoutDuplicateAssessment {
  const candidateWebsite = candidate.websiteUrl === undefined
    ? undefined
    : normalizeScoutWebsiteUrl(candidate.websiteUrl);
  const existingWebsite = existingLead.websiteUrl === undefined
    ? undefined
    : normalizeScoutWebsiteUrl(existingLead.websiteUrl);

  if (candidateWebsite !== undefined && existingWebsite !== undefined) {
    if (candidateWebsite === existingWebsite) return "EXACT_DUPLICATE";
    return hasPotentialNameAndLocationMatch(candidate, existingLead) ? "AMBIGUOUS" : "DISTINCT";
  }

  if (candidateWebsite === undefined && existingWebsite === undefined) {
    if (hasSameCompleteNameAndLocation(candidate, existingLead)) return "EXACT_DUPLICATE";
    return hasPotentialNameAndLocationMatch(candidate, existingLead) ? "AMBIGUOUS" : "DISTINCT";
  }

  return hasPotentialNameAndLocationMatch(candidate, existingLead) ? "AMBIGUOUS" : "DISTINCT";
}

function matchesTargetLocation(candidate: ScoutDiscoveryCandidate, targetLocations: readonly string[]): boolean {
  if (targetLocations.length === 0) return true;
  const targets = new Set(targetLocations.map((location) => normalizeComparableText(location)));
  return [candidate.city, candidate.region]
    .map((value) => normalizeComparableText(value))
    .some((value) => value !== undefined && targets.has(value));
}

function matchesTargetSegment(candidate: ScoutDiscoveryCandidate, targetSegments: readonly string[]): boolean {
  if (targetSegments.length === 0) return true;
  const segment = normalizeComparableText(candidate.segment);
  const targets = new Set(targetSegments.map((value) => normalizeComparableText(value)));
  return segment !== undefined && targets.has(segment);
}

function isObjectivelyEligible(candidate: ScoutDiscoveryCandidate, criteria: ScoutCriteria): boolean {
  const targetLocations = criteria.targetLocations ?? [];
  const targetSegments = criteria.targetSegments ?? [];
  return matchesTargetLocation(candidate, targetLocations)
    && matchesTargetSegment(candidate, targetSegments)
    && (!criteria.requirePublicWebsite || candidate.websiteUrl !== undefined);
}

/**
 * Auditable, fixed-order explanation of the objective criteria that accepted a
 * candidate. Inactive criteria deliberately produce no basis entry.
 */
function buildBasis(candidate: ScoutDiscoveryCandidate, criteria: ScoutCriteria): string[] {
  const basis: string[] = [];
  const targetLocations = criteria.targetLocations ?? [];
  const normalizedTargets = new Set(targetLocations.map((value) => normalizeComparableText(value)));
  const cityMatches = candidate.city !== undefined
    && normalizedTargets.has(normalizeComparableText(candidate.city));
  const regionMatches = candidate.region !== undefined
    && normalizedTargets.has(normalizeComparableText(candidate.region));

  if (cityMatches && regionMatches) {
    basis.push(`Discovery record reports city as ${candidate.city} and region as ${candidate.region}.`);
  } else if (cityMatches) {
    basis.push(`Discovery record reports city as ${candidate.city}.`);
  } else if (regionMatches) {
    basis.push(`Discovery record reports region as ${candidate.region}.`);
  }

  const targetSegments = criteria.targetSegments ?? [];
  if (candidate.segment !== undefined && targetSegments.length > 0) {
    basis.push(`Discovery candidate matches segment ${candidate.segment}.`);
  }

  if (criteria.requirePublicWebsite && candidate.websiteUrl !== undefined) {
    basis.push("A public HTTP(S) website URL was supplied.");
  }

  basis.push(`Discovery provenance type is ${candidate.source.type}.`);
  return basis;
}

function hasAmbiguousDuplicate(
  candidate: ScoutDiscoveryCandidate,
  existingLeads: readonly ScoutExistingLeadReference[],
): boolean {
  return existingLeads.some((existingLead) => assessScoutDuplicate(candidate, existingLead) === "AMBIGUOUS");
}

function isExactDuplicate(
  candidate: ScoutDiscoveryCandidate,
  existingLeads: readonly ScoutExistingLeadReference[],
): boolean {
  return existingLeads.some((existingLead) => assessScoutDuplicate(candidate, existingLead) === "EXACT_DUPLICATE");
}

/**
 * Pure V0 selection: examine only the requested prefix of discovery input,
 * discard deterministic duplicates/ineligible records, then return the first
 * remaining candidate in original input order. No scoring is performed.
 */
export function runScoutDeterministicSelection(input: ScoutInput): ScoutResult {
  const parsed = scoutInputSchema.parse(input);
  if (parsed.discoveryCandidates.length === 0) {
    return scoutResultSchema.parse({
      outcome: "NONE",
      reason: "NO_DISCOVERY_CANDIDATES",
      unresolvedQuestions: [],
    });
  }

  const candidatesToInspect = parsed.discoveryCandidates.slice(0, parsed.criteria.maxCandidatesToInspect);
  for (const candidate of candidatesToInspect) {
    if (isExactDuplicate(candidate, parsed.existingLeadReferences)) continue;
    if (!isObjectivelyEligible(candidate, parsed.criteria)) continue;

    return scoutResultSchema.parse({
      outcome: "FOUND",
      candidate,
      basis: buildBasis(candidate, parsed.criteria),
      unresolvedQuestions: hasAmbiguousDuplicate(candidate, parsed.existingLeadReferences)
        ? ["A possible existing Lead could not be resolved by the V0 deterministic duplicate rule."]
        : [],
    });
  }

  return scoutResultSchema.parse({
    outcome: "NONE",
    reason: "NO_ELIGIBLE_CANDIDATE",
    unresolvedQuestions: [],
  });
}
