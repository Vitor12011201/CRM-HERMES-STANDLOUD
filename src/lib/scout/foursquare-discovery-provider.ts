import { env } from "cloudflare:workers";

import {
  maxScoutDiscoveryCandidates,
  scoutDiscoveryCandidateSchema,
  type ScoutDiscoveryCandidate,
} from "./contracts";
import {
  ScoutDiscoveryProviderError,
  scoutDiscoveryRequestSchema,
  type ScoutDiscoveryProvider,
  type ScoutDiscoveryProviderErrorCode,
  type ScoutDiscoveryProviderResult,
  type ScoutDiscoveryRequest,
} from "./discovery-provider";

export const foursquarePlacesSearchEndpoint = "https://places-api.foursquare.com/places/search";
export const foursquarePlacesApiVersion = "2025-06-17";
export const foursquareDiscoveryTimeoutMs = 10_000;
export const maxFoursquareDiscoveryResponseBytes = 1_048_576;
export const foursquareContabilidadeCategoryId = "63be6904847c3692a84b9b3e";

type FoursquareWorkerEnvironment = {
  FOURSQUARE_PLACES_API_KEY?: unknown;
};

export type FoursquareFetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type FoursquareScoutDiscoveryFailure =
  | "FOURSQUARE_CREDENTIAL_REQUIRED"
  | "FOURSQUARE_TIMEOUT"
  | "FOURSQUARE_NETWORK_ERROR"
  | "FOURSQUARE_UNAUTHORIZED"
  | "FOURSQUARE_RATE_LIMITED"
  | "FOURSQUARE_BAD_REQUEST"
  | "FOURSQUARE_FORBIDDEN"
  | "FOURSQUARE_NOT_FOUND"
  | "FOURSQUARE_UNPROCESSABLE"
  | "FOURSQUARE_SERVER_ERROR"
  | "FOURSQUARE_HTTP_ERROR"
  | "FOURSQUARE_INVALID_RESPONSE"
  | "FOURSQUARE_INVALID_CANDIDATE"
  | "FOURSQUARE_LIMIT_EXCEEDED"
  | "FOURSQUARE_RESPONSE_TOO_LARGE";

function errorCodeForFailure(failure: FoursquareScoutDiscoveryFailure): ScoutDiscoveryProviderErrorCode {
  switch (failure) {
    case "FOURSQUARE_INVALID_RESPONSE":
      return "DISCOVERY_INVALID_RESPONSE";
    case "FOURSQUARE_INVALID_CANDIDATE":
      return "DISCOVERY_INVALID_CANDIDATE";
    case "FOURSQUARE_LIMIT_EXCEEDED":
    case "FOURSQUARE_RESPONSE_TOO_LARGE":
      return "DISCOVERY_LIMIT_EXCEEDED";
    default:
      return "DISCOVERY_PROVIDER_FAILED";
  }
}

/**
 * A sanitized provider-boundary error. Its public message and code never
 * expose transport payloads, headers, or the Foursquare service key.
 */
export class FoursquareScoutDiscoveryProviderError extends ScoutDiscoveryProviderError {
  constructor(
    public readonly failure: FoursquareScoutDiscoveryFailure,
    public readonly status?: number,
  ) {
    super(errorCodeForFailure(failure));
    this.name = "FoursquareScoutDiscoveryProviderError";
  }
}

export type FoursquareScoutDiscoveryProviderOptions = {
  fetchImplementation?: FoursquareFetchImplementation;
  timeoutMs?: number;
  /** Test seam only. Production instances always resolve the Worker environment secret. */
  getApiKeyForTesting?: () => string | undefined;
};

function fourSquareFailure(failure: FoursquareScoutDiscoveryFailure, status?: number): never {
  throw new FoursquareScoutDiscoveryProviderError(failure, status);
}

function classifyHttpFailure(status: number): FoursquareScoutDiscoveryFailure {
  if (status === 400) return "FOURSQUARE_BAD_REQUEST";
  if (status === 401) return "FOURSQUARE_UNAUTHORIZED";
  if (status === 403) return "FOURSQUARE_FORBIDDEN";
  if (status === 404) return "FOURSQUARE_NOT_FOUND";
  if (status === 422) return "FOURSQUARE_UNPROCESSABLE";
  if (status === 429) return "FOURSQUARE_RATE_LIMITED";
  if (status >= 500 && status <= 599) return "FOURSQUARE_SERVER_ERROR";
  return "FOURSQUARE_HTTP_ERROR";
}

function getFoursquareApiKeyFromEnvironment(): string | undefined {
  const value = (env as unknown as FoursquareWorkerEnvironment).FOURSQUARE_PLACES_API_KEY;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function getTimeoutMs(value: number | undefined): number {
  if (value === undefined) return foursquareDiscoveryTimeoutMs;
  if (!Number.isFinite(value) || value <= 0 || value > foursquareDiscoveryTimeoutMs) {
    throw new TypeError("Foursquare discovery timeout must be a positive value at most 10 seconds.");
  }
  return value;
}


function resolveMappedFoursquareSegment(request: ScoutDiscoveryRequest): "Contabilidade" | undefined {
  return request.targetSegments?.length === 1
    && normalizedComparableText(request.targetSegments[0]) === normalizedComparableText("Contabilidade")
    ? "Contabilidade"
    : undefined;
}

function buildFoursquareSearchUrl(
  request: ScoutDiscoveryRequest,
  mappedSegment: "Contabilidade" | undefined,
): URL {
  const url = new URL(foursquarePlacesSearchEndpoint);
  url.searchParams.set("fields", "fsq_place_id,name,location,categories,website");
  url.searchParams.set("limit", String(request.limit));

  const location = request.targetLocations?.[0];
  if (location) {
    const near = [location.city, location.region].filter(
      (value): value is string => value !== undefined,
    ).join(", ");
    if (near) url.searchParams.set("near", near);
  }

  if (mappedSegment !== undefined) {
    url.searchParams.set("fsq_category_ids", foursquareContabilidadeCategoryId);
  } else {
    const segment = request.targetSegments?.[0];
    if (segment !== undefined) url.searchParams.set("query", segment);
  }
  return url;
}

function hasOversizedContentLength(response: Response): boolean {
  const contentLength = response.headers.get("content-length")?.trim();
  return contentLength !== undefined
    && /^\d+$/.test(contentLength)
    && Number(contentLength) > maxFoursquareDiscoveryResponseBytes;
}

async function readBodyWithinLimit(response: Response): Promise<Uint8Array> {
  if (hasOversizedContentLength(response)) return fourSquareFailure("FOURSQUARE_RESPONSE_TOO_LARGE");

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxFoursquareDiscoveryResponseBytes) {
      return fourSquareFailure("FOURSQUARE_RESPONSE_TOO_LARGE");
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxFoursquareDiscoveryResponseBytes) {
        await reader.cancel();
        return fourSquareFailure("FOURSQUARE_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function normalizedComparableText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function stringFromRecord(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function categoryNames(record: Record<string, unknown>): string[] {
  const categories = record.categories;
  if (!Array.isArray(categories)) return [];

  return categories.flatMap((category) => {
    if (typeof category !== "object" || category === null || Array.isArray(category)) return [];
    const name = stringFromRecord(category, "name");
    return name === undefined ? [] : [name];
  });
}
function deriveSegmentForTextualQuery(
  record: Record<string, unknown>,
  request: ScoutDiscoveryRequest,
): string | undefined {
  const requestedSegments = new Set(
    (request.targetSegments ?? []).map((segment) => normalizedComparableText(segment)),
  );
  if (requestedSegments.size === 0) return undefined;

  const categories = categoryNames(record);
  if (categories.length === 0) return undefined;

  return categories.find((category) => requestedSegments.has(normalizedComparableText(category)));
}

function mapPlaceToCandidate(
  place: unknown,
  request: ScoutDiscoveryRequest,
  mappedSegment: "Contabilidade" | undefined,
): ScoutDiscoveryCandidate {
  const record = typeof place === "object" && place !== null && !Array.isArray(place)
    ? place as Record<string, unknown>
    : {};
  const segment = mappedSegment ?? deriveSegmentForTextualQuery(record, request);
  const location = typeof record.location === "object" && record.location !== null
    && !Array.isArray(record.location)
    ? record.location as Record<string, unknown>
    : {};
  const candidate = {
    discoveryId: stringFromRecord(record, "fsq_place_id"),
    companyName: stringFromRecord(record, "name"),
    city: stringFromRecord(location, "locality"),
    region: stringFromRecord(location, "region"),
    segment,
    websiteUrl: stringFromRecord(record, "website"),
    // Preserve record-level Foursquare provenance after this candidate leaves
    // the provider-result envelope. No source URL is invented when absent.
    source: { type: "FOURSQUARE" },
  };

  const parsedCandidate = scoutDiscoveryCandidateSchema.safeParse(candidate);
  if (!parsedCandidate.success) return fourSquareFailure("FOURSQUARE_INVALID_CANDIDATE");
  return parsedCandidate.data;
}

function parseFoursquareResponse(
  value: unknown,
  request: ScoutDiscoveryRequest,
  mappedSegment: "Contabilidade" | undefined,
): ScoutDiscoveryCandidate[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fourSquareFailure("FOURSQUARE_INVALID_RESPONSE");
  }

  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return fourSquareFailure("FOURSQUARE_INVALID_RESPONSE");
  if (results.length > maxScoutDiscoveryCandidates || results.length > request.limit) {
    return fourSquareFailure("FOURSQUARE_LIMIT_EXCEEDED");
  }

  return results.map((place) => mapPlaceToCandidate(place, request, mappedSegment));
}

/**
 * One controlled Foursquare Place Search call. It maps source records only:
 * selection, deduplication, and commercial interpretation remain outside this
 * provider in Scout and later layers.
 */
export class FoursquareScoutDiscoveryProvider implements ScoutDiscoveryProvider {
  readonly provider = "FOURSQUARE" as const;

  private readonly fetchImplementation: FoursquareFetchImplementation;
  private readonly timeoutMs: number;
  private readonly getApiKey: () => string | undefined;

  constructor(options: FoursquareScoutDiscoveryProviderOptions = {}) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = getTimeoutMs(options.timeoutMs);
    this.getApiKey = options.getApiKeyForTesting ?? getFoursquareApiKeyFromEnvironment;
  }

  async discover(request: ScoutDiscoveryRequest): Promise<ScoutDiscoveryProviderResult> {
    const parsedRequest = scoutDiscoveryRequestSchema.safeParse(request);
    if (!parsedRequest.success) throw new ScoutDiscoveryProviderError("DISCOVERY_INVALID_REQUEST");

    if (
      (parsedRequest.data.targetLocations?.length ?? 0) > 1
      || (parsedRequest.data.targetSegments?.length ?? 0) > 1
    ) {
      throw new ScoutDiscoveryProviderError("DISCOVERY_INVALID_REQUEST");
    }

    const apiKey = this.getApiKey();
    if (apiKey === undefined) return fourSquareFailure("FOURSQUARE_CREDENTIAL_REQUIRED");

    const mappedSegment = resolveMappedFoursquareSegment(parsedRequest.data);

    const controller = new AbortController();
    const fetchImplementation = this.fetchImplementation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new FoursquareScoutDiscoveryProviderError("FOURSQUARE_TIMEOUT"));
      }, this.timeoutMs);
    });

    try {
      let response: Response;
      try {
        response = await Promise.race([
          fetchImplementation(buildFoursquareSearchUrl(parsedRequest.data, mappedSegment), {
            method: "GET",
            credentials: "omit",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${apiKey}`,
              "X-Places-Api-Version": foursquarePlacesApiVersion,
            },
            signal: controller.signal,
          }),
          timeout,
        ]);
      } catch (error) {
        if (error instanceof FoursquareScoutDiscoveryProviderError) throw error;
        if (controller.signal.aborted) return fourSquareFailure("FOURSQUARE_TIMEOUT");
        return fourSquareFailure("FOURSQUARE_NETWORK_ERROR");
      }

      if (!response.ok) return fourSquareFailure(classifyHttpFailure(response.status), response.status);

      let body: Uint8Array;
      try {
        body = await Promise.race([readBodyWithinLimit(response), timeout]);
      } catch (error) {
        if (error instanceof FoursquareScoutDiscoveryProviderError) throw error;
        if (controller.signal.aborted) return fourSquareFailure("FOURSQUARE_TIMEOUT");
        return fourSquareFailure("FOURSQUARE_NETWORK_ERROR");
      }

      let responseJson: unknown;
      try {
        responseJson = JSON.parse(new TextDecoder().decode(body));
      } catch {
        return fourSquareFailure("FOURSQUARE_INVALID_RESPONSE");
      }

      return {
        provider: this.provider,
        candidates: parseFoursquareResponse(responseJson, parsedRequest.data, mappedSegment),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
