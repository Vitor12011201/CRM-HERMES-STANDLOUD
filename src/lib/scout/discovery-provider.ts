import { z } from "zod";

import {
  maxScoutDiscoveryCandidates,
  maxScoutLocationLength,
  maxScoutSegmentLength,
  scoutDiscoveryCandidateSchema,
  type ScoutDiscoveryCandidate,
} from "./contracts";

export const maxScoutDiscoveryProviderLocations = 20;
export const maxScoutDiscoveryProviderSegments = 20;

const requiredText = (maximumLength: number) => z.string().trim().min(1).max(maximumLength);

const optionalText = (maximumLength: number) => z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  requiredText(maximumLength).optional(),
);

/** Objective location constraints accepted by a future external discovery source. */
export const scoutDiscoveryRequestLocationSchema = z.object({
  city: optionalText(maxScoutLocationLength),
  region: optionalText(maxScoutLocationLength),
}).strict().refine((location) => location.city !== undefined || location.region !== undefined, {
  message: "A discovery location must contain city or region.",
});

/**
 * A request describes only objective source-side constraints. It deliberately
 * has no commercial criteria, score, ranking, or recommendation fields.
 */
export const scoutDiscoveryRequestSchema = z.object({
  targetLocations: z.array(scoutDiscoveryRequestLocationSchema)
    .max(maxScoutDiscoveryProviderLocations)
    .optional(),
  targetSegments: z.array(requiredText(maxScoutSegmentLength))
    .max(maxScoutDiscoveryProviderSegments)
    .optional(),
  limit: z.number().int().min(1).max(maxScoutDiscoveryCandidates),
}).strict();

/** Explicitly supported source adapters; arbitrary provider strings are rejected. */
export const scoutDiscoveryProviderNameSchema = z.enum(["SYNTHETIC", "FOURSQUARE"]);

/**
 * Provider output intentionally permits duplicate records. Exact duplicate
 * ownership remains with Scout V0 rather than moving into source adapters.
 */
export const scoutDiscoveryProviderResultSchema = z.object({
  provider: scoutDiscoveryProviderNameSchema,
  candidates: z.array(scoutDiscoveryCandidateSchema).max(maxScoutDiscoveryCandidates),
}).strict();

export type ScoutDiscoveryRequest = z.infer<typeof scoutDiscoveryRequestSchema>;
export type ScoutDiscoveryProviderName = z.infer<typeof scoutDiscoveryProviderNameSchema>;
export type ScoutDiscoveryProviderResult = z.infer<typeof scoutDiscoveryProviderResultSchema>;

/** A source adapter supplies validated Scout candidates but never selects one. */
export interface ScoutDiscoveryProvider {
  readonly provider: ScoutDiscoveryProviderName;
  discover(request: ScoutDiscoveryRequest): Promise<ScoutDiscoveryProviderResult>;
}

export type ScoutDiscoveryProviderErrorCode =
  | "DISCOVERY_INVALID_REQUEST"
  | "DISCOVERY_PROVIDER_FAILED"
  | "DISCOVERY_INVALID_RESPONSE"
  | "DISCOVERY_INVALID_CANDIDATE"
  | "DISCOVERY_LIMIT_EXCEEDED";

/** Sanitized boundary error; raw provider exceptions and records are not exposed. */
export class ScoutDiscoveryProviderError extends Error {
  constructor(public readonly code: ScoutDiscoveryProviderErrorCode) {
    super(code);
    this.name = "ScoutDiscoveryProviderError";
  }
}

function classifyInvalidProviderResult(value: unknown): ScoutDiscoveryProviderErrorCode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "DISCOVERY_INVALID_RESPONSE";
  }

  const candidates = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "DISCOVERY_INVALID_RESPONSE";
  if (candidates.length > maxScoutDiscoveryCandidates) return "DISCOVERY_LIMIT_EXCEEDED";
  if (candidates.some((candidate) => !scoutDiscoveryCandidateSchema.safeParse(candidate).success)) {
    return "DISCOVERY_INVALID_CANDIDATE";
  }

  return "DISCOVERY_INVALID_RESPONSE";
}

/**
 * Validates a provider invocation end-to-end and returns source order unchanged.
 * It does not filter, deduplicate, rank, or run Scout selection.
 */
export async function discoverScoutCandidates(
  provider: ScoutDiscoveryProvider,
  request: ScoutDiscoveryRequest,
): Promise<ScoutDiscoveryCandidate[]> {
  const parsedRequest = scoutDiscoveryRequestSchema.safeParse(request);
  if (!parsedRequest.success) throw new ScoutDiscoveryProviderError("DISCOVERY_INVALID_REQUEST");

  let rawResult: ScoutDiscoveryProviderResult;
  try {
    rawResult = await provider.discover(parsedRequest.data);
  } catch (error) {
    if (error instanceof ScoutDiscoveryProviderError) throw error;
    throw new ScoutDiscoveryProviderError("DISCOVERY_PROVIDER_FAILED");
  }

  const parsedResult = scoutDiscoveryProviderResultSchema.safeParse(rawResult);
  if (!parsedResult.success) {
    throw new ScoutDiscoveryProviderError(classifyInvalidProviderResult(rawResult));
  }
  if (parsedResult.data.provider !== provider.provider) {
    throw new ScoutDiscoveryProviderError("DISCOVERY_INVALID_RESPONSE");
  }

  return parsedResult.data.candidates;
}

/** Test-only/in-memory source that preserves its supplied synthetic source order. */
export class InMemoryScoutDiscoveryProvider implements ScoutDiscoveryProvider {
  readonly provider = "SYNTHETIC" as const;

  constructor(private readonly fixtures: readonly ScoutDiscoveryCandidate[]) {}

  async discover(): Promise<ScoutDiscoveryProviderResult> {
    return {
      provider: this.provider,
      candidates: this.fixtures.map((candidate) => ({
        ...candidate,
        source: { ...candidate.source },
      })),
    };
  }
}
