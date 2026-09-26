import { env } from "cloudflare:workers";
import { z } from "zod";

import type { EvidenceSourceType } from "@/generated/prisma/enums";
import { getDb, type DbClient } from "@/lib/db";
import {
  createD1LeadEnrichmentCommitter,
  LeadEnrichmentCommitError,
  type LeadEnrichmentCommitter,
} from "@/lib/lead-enrichment-commit";
import {
  researcherResultSchema,
  type ResearcherEvidence,
  type ResearcherResult,
} from "@/lib/researcher/contracts";

/** Only factual contact values may be enriched in V1. */
export const leadEnrichmentFieldSchema = z.enum(["EMAIL", "PHONE", "WHATSAPP"]);
export type LeadEnrichmentField = z.infer<typeof leadEnrichmentFieldSchema>;

export type LeadEnrichmentSuggestion = {
  id: string;
  field: LeadEnrichmentField;
  value: string;
  evidenceIndex: number;
  sourceType: EvidenceSourceType;
  sourceUrl: string | null;
};

export type LeadEnrichmentAppliedField = Pick<LeadEnrichmentSuggestion, "field" | "value" | "sourceType" | "sourceUrl"> & {
  outcome: "FILLED" | "ALREADY_PRESENT";
};

export type LeadEnrichmentApplication = {
  leadId: string;
  runId: string;
  fields: LeadEnrichmentAppliedField[];
};

export const leadEnrichmentApplyInputSchema = z.object({
  suggestionIds: z.array(z.string().trim().min(1).max(4096)).min(1).max(3).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Suggestion IDs must be unique." });
    }
  }),
}).strict();

export type LeadEnrichmentErrorCode =
  | "RESEARCH_RUN_NOT_FOUND"
  | "LEAD_ENRICHMENT_RUN_NOT_APPROVED"
  | "LEAD_ENRICHMENT_RUN_INVALID"
  | "LEAD_ENRICHMENT_INPUT_INVALID"
  | "LEAD_ENRICHMENT_SUGGESTION_NOT_FOUND"
  | "ENRICHMENT_MULTIPLE_VALUES_FOR_FIELD"
  | "LEAD_ENRICHMENT_FIELD_CONFLICT"
  | "LEAD_ENRICHMENT_COMMIT_FAILED"
  | "LEAD_ENRICHMENT_WRITE_FAILED";

/** Deliberately code-only: routes never expose database or evidence internals on errors. */
export class LeadEnrichmentError extends Error {
  constructor(public readonly code: LeadEnrichmentErrorCode) {
    super(code);
    this.name = "LeadEnrichmentError";
  }
}

type StoredEnrichmentRun = {
  id: string;
  leadId: string;
  status: string;
  resultJson: string;
  approvedEvidenceIndexesJson: string | null;
};

type EnrichmentLead = {
  id: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
};

export type LeadEnrichmentStore = {
  findRun(runId: string): Promise<StoredEnrichmentRun | null>;
  findLead(leadId: string): Promise<EnrichmentLead | null>;
};

export type LeadEnrichmentDependencies = {
  store: LeadEnrichmentStore;
  committer: LeadEnrichmentCommitter;
};

const fieldToLeadColumn = {
  EMAIL: "email",
  PHONE: "phone",
  WHATSAPP: "whatsapp",
} as const;

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi;
const phoneCandidatePattern = /(?:\+?55[\s().-]*)?(?:\(?[1-9]\d\)?[\s.-]*)?(?:[2-9]\d{3,4})[\s.-]?\d{4}/g;
const phoneContextPattern = /(?:telefone|tel\.?|fone|contato|whats(?:app)?)/i;
const whatsappMarkerPattern = /\bwhats(?:app)?\b|wa\.me\/|api\.whatsapp\.com/i;
const whatsappUrlPattern = /(?:wa\.me\/|api\.whatsapp\.com\/send\?[^\s]*\bphone=)(\d{10,13})/gi;

function stableSuggestionId(
  field: LeadEnrichmentField,
  evidenceIndex: number,
  sourceType: EvidenceSourceType,
  sourceUrl: string | null,
  value: string,
) {
  return `lead-enrichment:${encodeURIComponent(JSON.stringify([field, evidenceIndex, sourceType, sourceUrl, value]))}`;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Keeps a Brazilian number readable while accepting an explicit +55 prefix.
 * A local eight/nine-digit number remains local; no DDD is ever invented.
 */
export function normalizeBrazilianPhone(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  if (digits.length === 10 || digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);
    if (!/^[1-9]\d$/.test(ddd)) return null;
    return local.length === 9
      ? `(${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`
      : `(${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
  }

  if (digits.length === 8 || digits.length === 9) {
    return digits.length === 9
      ? `${digits.slice(0, 5)}-${digits.slice(5)}`
      : `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  return null;
}

function extractEmails(observation: string) {
  return [...observation.matchAll(emailPattern)].map((match) => normalizeEmail(match[0]));
}

function extractPhones(observation: string) {
  const values: string[] = [];
  for (const match of observation.matchAll(phoneCandidatePattern)) {
    const normalized = normalizeBrazilianPhone(match[0]);
    if (!normalized) continue;
    // A local number has no DDD. Keep it only when the evidence labels it as a contact;
    // otherwise a short numeric fact (for example a year range) is not a safe suggestion.
    const nearbyContext = observation.slice(Math.max(0, (match.index ?? 0) - 32), match.index ?? 0);
    if (!normalized.startsWith("(") && !phoneContextPattern.test(nearbyContext)) continue;
    values.push(normalized);
  }
  return values;
}

function extractWhatsappPhones(observation: string) {
  if (!whatsappMarkerPattern.test(observation)) return [];
  const candidates = extractPhones(observation);
  for (const match of observation.matchAll(whatsappUrlPattern)) {
    const normalized = normalizeBrazilianPhone(match[1]);
    if (normalized) candidates.push(normalized);
  }
  return candidates;
}

function addSuggestions(
  output: LeadEnrichmentSuggestion[],
  seen: Set<string>,
  field: LeadEnrichmentField,
  values: readonly string[],
  evidenceIndex: number,
  evidence: ResearcherEvidence,
) {
  for (const value of values) {
    const key = `${field}\u001f${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceUrl = evidence.sourceUrl ?? null;
    output.push({
      id: stableSuggestionId(field, evidenceIndex, evidence.sourceType, sourceUrl, value),
      field,
      value,
      evidenceIndex,
      sourceType: evidence.sourceType,
      sourceUrl,
    });
  }
}

/**
 * Pure and deterministic: only human-approved evidence indexes are considered.
 * Unapproved candidates, model metadata and browser-provided facts are excluded.
 */
export function deriveLeadEnrichmentSuggestions(
  result: ResearcherResult,
  approvedEvidenceIndexes: readonly number[],
): LeadEnrichmentSuggestion[] {
  const output: LeadEnrichmentSuggestion[] = [];
  const seen = new Set<string>();
  const indexes = [...new Set(approvedEvidenceIndexes)].sort((left, right) => left - right);

  for (const evidenceIndex of indexes) {
    const evidence = result.evidence[evidenceIndex];
    if (!evidence) continue;
    addSuggestions(output, seen, "EMAIL", extractEmails(evidence.observation), evidenceIndex, evidence);
    addSuggestions(output, seen, "PHONE", extractPhones(evidence.observation), evidenceIndex, evidence);
    addSuggestions(output, seen, "WHATSAPP", extractWhatsappPhones(evidence.observation), evidenceIndex, evidence);
  }

  return output;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new LeadEnrichmentError("LEAD_ENRICHMENT_RUN_INVALID");
  }
}

function parseApprovedRun(run: StoredEnrichmentRun) {
  if (run.status !== "APPROVED") {
    throw new LeadEnrichmentError("LEAD_ENRICHMENT_RUN_NOT_APPROVED");
  }
  const result = researcherResultSchema.safeParse(parseJson(run.resultJson));
  const indexes = z.array(z.number().int().nonnegative()).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "Duplicate approved indexes." });
    }
  }).safeParse(run.approvedEvidenceIndexesJson === null ? null : parseJson(run.approvedEvidenceIndexesJson));
  if (!result.success || !indexes.success || run.approvedEvidenceIndexesJson === null) {
    throw new LeadEnrichmentError("LEAD_ENRICHMENT_RUN_INVALID");
  }
  if (indexes.data.some((index) => index >= result.data.evidence.length)) {
    throw new LeadEnrichmentError("LEAD_ENRICHMENT_RUN_INVALID");
  }
  return { result: result.data, approvedEvidenceIndexes: indexes.data };
}

async function requireApprovedRun(
  leadId: string,
  runId: string,
  store: LeadEnrichmentStore,
) {
  let run: StoredEnrichmentRun | null;
  try {
    run = await store.findRun(runId);
  } catch {
    throw new LeadEnrichmentError("LEAD_ENRICHMENT_WRITE_FAILED");
  }
  if (!run || run.leadId !== leadId) throw new LeadEnrichmentError("RESEARCH_RUN_NOT_FOUND");
  return parseApprovedRun(run);
}

export function createLeadEnrichmentStore(db: DbClient): LeadEnrichmentStore {
  return {
    async findRun(runId) {
      return db.leadResearchRun.findUnique({
        where: { id: runId },
        select: {
          id: true,
          leadId: true,
          status: true,
          resultJson: true,
          approvedEvidenceIndexesJson: true,
        },
      });
    },
    async findLead(leadId) {
      return db.lead.findUnique({
        where: { id: leadId },
        select: { id: true, email: true, phone: true, whatsapp: true },
      });
    },
  };
}

function normalizeExistingValue(field: LeadEnrichmentField, value: string | null) {
  if (value === null || value.trim() === "") return null;
  if (field === "EMAIL") return normalizeEmail(value);
  return normalizeBrazilianPhone(value) ?? value.trim();
}

function resolveSelectedSuggestions(
  suggestions: readonly LeadEnrichmentSuggestion[],
  suggestionIds: readonly string[],
) {
  const selected = suggestionIds.map((id) => suggestions.find((suggestion) => suggestion.id === id));
  if (selected.some((suggestion) => !suggestion)) {
    throw new LeadEnrichmentError("LEAD_ENRICHMENT_SUGGESTION_NOT_FOUND");
  }
  const values = selected as LeadEnrichmentSuggestion[];
  const fields = new Set<LeadEnrichmentField>();
  for (const suggestion of values) {
    if (fields.has(suggestion.field)) {
      throw new LeadEnrichmentError("ENRICHMENT_MULTIPLE_VALUES_FOR_FIELD");
    }
    fields.add(suggestion.field);
  }
  return values;
}

type EnrichmentOutcome = {
  result: LeadEnrichmentApplication;
};

async function applyWithStore(
  leadId: string,
  runId: string,
  input: z.infer<typeof leadEnrichmentApplyInputSchema>,
  dependencies: LeadEnrichmentDependencies,
): Promise<EnrichmentOutcome> {
  const { store, committer } = dependencies;
  const approved = await requireApprovedRun(leadId, runId, store);
  const selected = resolveSelectedSuggestions(
    deriveLeadEnrichmentSuggestions(approved.result, approved.approvedEvidenceIndexes),
    input.suggestionIds,
  );

  let lead: EnrichmentLead | null;
  try {
    lead = await store.findLead(leadId);
  } catch {
    throw new LeadEnrichmentError("LEAD_ENRICHMENT_WRITE_FAILED");
  }
  if (!lead) throw new LeadEnrichmentError("RESEARCH_RUN_NOT_FOUND");

  const expected: Parameters<LeadEnrichmentCommitter["commit"]>[0]["expected"] = {};
  const changes: Parameters<LeadEnrichmentCommitter["commit"]>[0]["changes"] = {};
  const fields: LeadEnrichmentAppliedField[] = [];
  const beforeData: Record<string, unknown> = {};
  const afterData: Record<string, unknown> = {};

  for (const suggestion of selected) {
    const column = fieldToLeadColumn[suggestion.field];
    const existing = lead[column];
    const normalizedExisting = normalizeExistingValue(suggestion.field, existing);
    if (normalizedExisting !== null && normalizedExisting !== suggestion.value) {
      throw new LeadEnrichmentError("LEAD_ENRICHMENT_FIELD_CONFLICT");
    }

    if (normalizedExisting === suggestion.value) {
      fields.push({ ...suggestion, outcome: "ALREADY_PRESENT" });
    } else {
      expected[column] = existing;
      changes[column] = suggestion.value;
      beforeData[column] = existing;
      afterData[column] = suggestion.value;
      fields.push({ ...suggestion, outcome: "FILLED" });
    }
  }

  if (Object.keys(changes).length > 0) {
    let committed: boolean;
    try {
      committed = (await committer.commit({ leadId, expected, changes, beforeData, afterData })).committed;
    } catch (error) {
      if (error instanceof LeadEnrichmentError) throw error;
      if (error instanceof LeadEnrichmentCommitError) {
        throw new LeadEnrichmentError("LEAD_ENRICHMENT_COMMIT_FAILED");
      }
      throw new LeadEnrichmentError("LEAD_ENRICHMENT_COMMIT_FAILED");
    }
    if (!committed) {
      const current = await store.findLead(leadId).catch(() => null);
      const nowMatches = current !== null && selected.every((suggestion) => {
        const column = fieldToLeadColumn[suggestion.field];
        return normalizeExistingValue(suggestion.field, current[column]) === suggestion.value;
      });
      if (!nowMatches) throw new LeadEnrichmentError("LEAD_ENRICHMENT_FIELD_CONFLICT");
      fields.forEach((field) => { field.outcome = "ALREADY_PRESENT"; });
    }
  }

  return {
    result: { leadId, runId, fields },
  };
}

export async function getLeadEnrichmentSuggestions(
  leadId: string,
  runId: string,
  dependencies?: Pick<LeadEnrichmentDependencies, "store">,
) {
  const approved = await requireApprovedRun(leadId, runId, dependencies?.store ?? createLeadEnrichmentStore(getDb()));
  return deriveLeadEnrichmentSuggestions(approved.result, approved.approvedEvidenceIndexes);
}

/**
 * Applies only server-regenerated suggestion values. The browser supplies IDs,
 * never a contact value, evidence observation, field or source URL.
 */
export async function applyLeadEnrichment(
  leadId: string,
  runId: string,
  input: unknown,
  dependencies?: LeadEnrichmentDependencies,
): Promise<LeadEnrichmentApplication> {
  const parsed = leadEnrichmentApplyInputSchema.safeParse(input);
  if (!parsed.success) throw new LeadEnrichmentError("LEAD_ENRICHMENT_INPUT_INVALID");
  const liveDependencies: LeadEnrichmentDependencies = dependencies ?? {
    store: createLeadEnrichmentStore(getDb()),
    committer: createD1LeadEnrichmentCommitter(env.DB),
  };
  return (await applyWithStore(leadId, runId, parsed.data, liveDependencies)).result;
}
