export const costEntryMeasurementDigestFormat = "cost-entry-measurement/v1";
export const costEntryMaximumSafeInteger = Number.MAX_SAFE_INTEGER;
export const costEntryMaximumScale = 18;

const sourceReferencePattern = /^sr:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type CostMeasurementNature = "ESTIMATED" | "ACTUAL";
export type CostKnowledge = "KNOWN" | "UNKNOWN";

export type CostEntryMeasurementIdentity = Readonly<{
  economicOccurrenceKey: string;
  measurementSliceKey: string;
  measurementNature: CostMeasurementNature;
  resourceKey: string;
  unitKey: string;
  quantityKnowledge: CostKnowledge;
  quantityCoefficient?: number | null;
  quantityScale?: number | null;
  monetaryKnowledge: CostKnowledge;
  amountMinor?: number | null;
  currency?: string | null;
  currencyScale?: number | null;
  measurementSourceKind: string;
  sourceReference?: string | null;
  evidenceSha256?: string | null;
  measurementBasisSha256: string;
  experimentId?: string | null;
  candidateId?: string | null;
  commercialCaseId?: string | null;
  executionRunId?: string | null;
}>;

export type CanonicalCostEntryMeasurementIdentity = Readonly<{
  format: typeof costEntryMeasurementDigestFormat;
  economicOccurrenceKey: string;
  measurementSliceKey: string;
  measurementNature: CostMeasurementNature;
  resourceKey: string;
  unitKey: string;
  quantityKnowledge: CostKnowledge;
  quantityCoefficient: number | null;
  quantityScale: number | null;
  monetaryKnowledge: CostKnowledge;
  amountMinor: number | null;
  currency: string | null;
  currencyScale: number | null;
  measurementSourceKind: string;
  sourceReference: string | null;
  evidenceSha256: string | null;
  measurementBasisSha256: string;
  directContext: Readonly<{ kind: "EXPERIMENT" | "CANDIDATE" | "COMMERCIAL_CASE" | "EXECUTION_RUN"; id: string }> | null;
}>;

export class CostEntryMeasurementIdentityError extends Error {
  constructor() {
    super("COST_ENTRY_MEASUREMENT_IDENTITY_INVALID");
  }
}

function requiredText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength || value.includes("\0")) {
    throw new CostEntryMeasurementIdentityError();
  }
  return value;
}

function optionalText(value: unknown, maximumLength: number): string | null {
  if (value === undefined || value === null) return null;
  return requiredText(value, maximumLength);
}

function digest(value: unknown): string {
  const result = requiredText(value, 64);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new CostEntryMeasurementIdentityError();
  return result;
}

function optionalDigest(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return digest(value);
}

function optionalSourceReference(value: unknown): string | null {
  const result = optionalText(value, 42);
  if (result !== null && !sourceReferencePattern.test(result)) throw new CostEntryMeasurementIdentityError();
  return result;
}

function optionalSafeInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CostEntryMeasurementIdentityError();
  return value as number;
}

function scale(value: unknown): number | null {
  const result = optionalSafeInteger(value);
  if (result !== null && result > costEntryMaximumScale) throw new CostEntryMeasurementIdentityError();
  return result;
}

function knowledge(value: unknown): CostKnowledge {
  if (value !== "KNOWN" && value !== "UNKNOWN") throw new CostEntryMeasurementIdentityError();
  return value;
}

function directContext(input: CostEntryMeasurementIdentity): CanonicalCostEntryMeasurementIdentity["directContext"] {
  const candidates = [
    { kind: "EXPERIMENT" as const, id: optionalText(input.experimentId, 128) },
    { kind: "CANDIDATE" as const, id: optionalText(input.candidateId, 128) },
    { kind: "COMMERCIAL_CASE" as const, id: optionalText(input.commercialCaseId, 128) },
    { kind: "EXECUTION_RUN" as const, id: optionalText(input.executionRunId, 128) },
  ];
  const present = candidates.filter((candidate) => candidate.id !== null);
  if (present.length > 1) throw new CostEntryMeasurementIdentityError();
  const selected = present[0];
  return selected === undefined ? null : { kind: selected.kind, id: selected.id as string };
}

/**
 * This descriptor deliberately excludes costEntryKey (the caller's logical
 * work/idempotency key), physical ids, and all timestamps. In particular,
 * occurredAt and observedAt are temporal evidence rather than economic
 * identity, so a corrected clock value cannot synthesize a new charge.
 */
export function canonicalizeCostEntryMeasurementIdentity(
  input: CostEntryMeasurementIdentity,
): CanonicalCostEntryMeasurementIdentity {
  if (input.measurementNature !== "ESTIMATED" && input.measurementNature !== "ACTUAL") {
    throw new CostEntryMeasurementIdentityError();
  }
  const quantityKnowledge = knowledge(input.quantityKnowledge);
  const quantityCoefficient = optionalSafeInteger(input.quantityCoefficient);
  const quantityScale = scale(input.quantityScale);
  if ((quantityKnowledge === "KNOWN" && (quantityCoefficient === null || quantityScale === null))
    || (quantityKnowledge === "UNKNOWN" && (quantityCoefficient !== null || quantityScale !== null))) {
    throw new CostEntryMeasurementIdentityError();
  }
  const monetaryKnowledge = knowledge(input.monetaryKnowledge);
  const amountMinor = optionalSafeInteger(input.amountMinor);
  const currency = optionalText(input.currency, 3);
  const currencyScale = scale(input.currencyScale);
  if ((monetaryKnowledge === "KNOWN" && (amountMinor === null || currency === null || currencyScale === null || !/^[A-Z]{3}$/.test(currency)))
    || (monetaryKnowledge === "UNKNOWN" && (amountMinor !== null || currency !== null || currencyScale !== null))) {
    throw new CostEntryMeasurementIdentityError();
  }
  const sourceReference = optionalSourceReference(input.sourceReference);
  const evidenceSha256 = optionalDigest(input.evidenceSha256);
  if (sourceReference === null && evidenceSha256 === null) throw new CostEntryMeasurementIdentityError();
  return {
    format: costEntryMeasurementDigestFormat,
    economicOccurrenceKey: requiredText(input.economicOccurrenceKey, 512),
    measurementSliceKey: requiredText(input.measurementSliceKey, 512),
    measurementNature: input.measurementNature,
    resourceKey: requiredText(input.resourceKey, 256),
    unitKey: requiredText(input.unitKey, 256),
    quantityKnowledge,
    quantityCoefficient,
    quantityScale,
    monetaryKnowledge,
    amountMinor,
    currency,
    currencyScale,
    measurementSourceKind: requiredText(input.measurementSourceKind, 128),
    sourceReference,
    evidenceSha256,
    measurementBasisSha256: digest(input.measurementBasisSha256),
    directContext: directContext(input),
  };
}

export function canonicalCostEntryMeasurementIdentityJson(input: CostEntryMeasurementIdentity): string {
  return JSON.stringify(canonicalizeCostEntryMeasurementIdentity(input));
}

export async function computeCanonicalCostEntrySha256(input: CostEntryMeasurementIdentity): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("COST_ENTRY_HASH_UNAVAILABLE");
  const digestBytes = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalCostEntryMeasurementIdentityJson(input)),
  );
  return Array.from(new Uint8Array(digestBytes), (part) => part.toString(16).padStart(2, "0")).join("");
}
