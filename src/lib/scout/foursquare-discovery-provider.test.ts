import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {},
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));

import { runScoutDeterministicSelection } from "./contracts";
import { discoverScoutCandidates } from "./discovery-provider";
import {
  FoursquareScoutDiscoveryProvider,
  foursquarePlacesApiVersion,
  foursquareContabilidadeCategoryId,
  foursquarePlacesSearchEndpoint,
  maxFoursquareDiscoveryResponseBytes,
  type FoursquareFetchImplementation,
} from "./foursquare-discovery-provider";

const testOnlyApiKey = "test-only-placeholder";

function request(overrides: Record<string, unknown> = {}) {
  return {
    targetLocations: [{ city: "Jacarei", region: "SP" }],
    targetSegments: ["Contabilidade"],
    limit: 10,
    ...overrides,
  };
}

function place(overrides: Record<string, unknown> = {}) {
  return {
    fsq_place_id: "fsq-atlas",
    name: "Atlas Contabilidade",
    location: {
      locality: "Jacarei",
      region: "SP",
    },
    categories: [{ id: foursquareContabilidadeCategoryId, name: "Accounting and Bookkeeping Services" }],
    website: "https://atlas.example/",
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function providerWithResponse(response: Response) {
  const fetchImplementation = vi.fn(async () => response);
  const provider = new FoursquareScoutDiscoveryProvider({
    fetchImplementation,
    getApiKeyForTesting: () => testOnlyApiKey,
  });
  return { fetchImplementation, provider };
}

describe("Foursquare Scout Discovery Provider", () => {
  it("maps a valid Place Search response with the exact requested fields", async () => {
    const { fetchImplementation, provider } = providerWithResponse(jsonResponse({ results: [place()] }));
    const result = await provider.discover(request());

    expect(result).toEqual({
      provider: "FOURSQUARE",
      candidates: [{
        discoveryId: "fsq-atlas",
        companyName: "Atlas Contabilidade",
        city: "Jacarei",
        region: "SP",
        segment: "Contabilidade",
        websiteUrl: "https://atlas.example/",
        source: { type: "FOURSQUARE" },
      }],
    });

    const [calledUrl, init] = fetchImplementation.mock.calls[0] ?? [];
    const url = new URL(String(calledUrl));
    expect(`${url.origin}${url.pathname}`).toBe(foursquarePlacesSearchEndpoint);
    expect(url.searchParams.get("near")).toBe("Jacarei, SP");
    expect(url.searchParams.get("fsq_category_ids")).toBe(foursquareContabilidadeCategoryId);
    expect(url.searchParams.get("query")).toBeNull();
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("fields")).toBe("fsq_place_id,name,location,categories,website");
    expect(url.searchParams.get("fields")).not.toContain("locality");
    expect(url.searchParams.get("fields")).not.toContain("region");
    expect(new Headers((init as RequestInit).headers).get("X-Places-Api-Version"))
      .toBe(foursquarePlacesApiVersion);
    expect(new Headers((init as RequestInit).headers).get("Authorization"))
      .toBe(`Bearer ${testOnlyApiKey}`);
  });

  it.each(["Contabilidade", "contabilidade", "CONTABILIDADE"])(
    "maps %s to the canonical Contabilidade Foursquare category filter",
    async (targetSegment) => {
      const { fetchImplementation, provider } = providerWithResponse(jsonResponse({ results: [place()] }));

      const [candidate] = (await provider.discover(request({ targetSegments: [targetSegment] }))).candidates;
      const [calledUrl] = fetchImplementation.mock.calls[0] ?? [];
      const url = new URL(String(calledUrl));

      expect(url.searchParams.get("fsq_category_ids")).toBe(foursquareContabilidadeCategoryId);
      expect(url.searchParams.get("query")).toBeNull();
      expect(candidate?.segment).toBe("Contabilidade");
    },
  );

  it("preserves Foursquare source order and does not deduplicate provider records", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [
        place({ fsq_place_id: "first", name: "First" }),
        place({ fsq_place_id: "first", name: "First" }),
        place({ fsq_place_id: "third", name: "Third" }),
      ],
    }));

    const result = await provider.discover(request());

    expect(result.candidates.map((candidate) => candidate.discoveryId)).toEqual(["first", "first", "third"]);
    expect(result.candidates).toHaveLength(3);
  });

  it("preserves an absent website and maps locality, region, and stable Foursquare ID", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [place({ fsq_place_id: "stable-fsq-id", website: undefined })],
    }));

    const result = await provider.discover(request());
    const [candidate] = result.candidates;

    expect(candidate).toMatchObject({
      discoveryId: "stable-fsq-id",
      city: "Jacarei",
      region: "SP",
      source: { type: "FOURSQUARE" },
    });
    expect(candidate?.websiteUrl).toBeUndefined();
    expect(candidate?.source).not.toHaveProperty("url");
  });

  it("keeps missing Foursquare location fields absent without top-level fallback", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [
        place({ location: { region: "SP" }, locality: "must-not-be-used", region: "must-not-be-used" }),
        place({ location: undefined, locality: "must-not-be-used", region: "must-not-be-used" }),
      ],
    }));

    const result = await provider.discover(request());

    expect(result.candidates[0]).toMatchObject({ region: "SP" });
    expect(result.candidates[0]?.city).toBeUndefined();
    expect(result.candidates[1]?.city).toBeUndefined();
    expect(result.candidates[1]?.region).toBeUndefined();
  });
  it("uses the structured request filter rather than response category data", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [place({ categories: [{ id: "different-category-id", name: "Contabilidade" }] })],
    }));

    const [candidate] = (await provider.discover(request())).candidates;
    expect(candidate?.segment).toBe("Contabilidade");
  });

  it("uses the structured request filter even when the response category label differs", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [place({ categories: [{ id: foursquareContabilidadeCategoryId, name: "Different label" }] })],
    }));

    const [candidate] = (await provider.discover(request())).candidates;
    expect(candidate?.segment).toBe("Contabilidade");
  });

  it("assigns Contabilidade when a category-filtered response has empty categories", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [place({ categories: [] })],
    }));

    const [candidate] = (await provider.discover(request())).candidates;
    expect(candidate?.segment).toBe("Contabilidade");
  });

  it("assigns Contabilidade when a category-filtered response omits categories", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [place({ categories: undefined })],
    }));

    const [candidate] = (await provider.discover(request())).candidates;
    expect(candidate?.segment).toBe("Contabilidade");
  });

  it("uses the prior textual query behavior for an unmapped segment without inventing a category ID", async () => {
    const { fetchImplementation, provider } = providerWithResponse(jsonResponse({ results: [place()] }));
    const result = await provider.discover(request({ targetSegments: ["Outro"] }));

    const [calledUrl] = fetchImplementation.mock.calls[0] ?? [];
    const url = new URL(String(calledUrl));
    expect(url.searchParams.get("fsq_category_ids")).toBeNull();
    expect(url.searchParams.get("query")).toBe("Outro");
    expect(result.candidates[0]?.segment).toBeUndefined();
  });

  it("does not invent a segment when the request has no target segments", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [place()],
    }));

    const [candidate] = (await provider.discover(request({ targetSegments: undefined }))).candidates;
    expect(candidate?.segment).toBeUndefined();
  });

  it("preserves the zero-target request behavior", async () => {
    const { fetchImplementation, provider } = providerWithResponse(jsonResponse({ results: [place()] }));

    const [candidate] = (await provider.discover(request({
      targetLocations: [],
      targetSegments: [],
    }))).candidates;
    const [calledUrl] = fetchImplementation.mock.calls[0] ?? [];
    const url = new URL(String(calledUrl));

    expect(url.searchParams.get("near")).toBeNull();
    expect(url.searchParams.get("fsq_category_ids")).toBeNull();
    expect(url.searchParams.get("query")).toBeNull();
    expect(candidate?.segment).toBeUndefined();
  });

  it.each([
    { targetLocations: [{ city: "Jacarei" }, { city: "Sao Jose dos Campos" }] },
    { targetSegments: ["Contabilidade", "Outro"] },
  ])("fails closed for multiple source-side targets without fetching", async (overrides) => {
    const { fetchImplementation, provider } = providerWithResponse(jsonResponse({ results: [place()] }));

    await expect(provider.discover(request(overrides))).rejects.toMatchObject({
      code: "DISCOVERY_INVALID_REQUEST",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [400, "FOURSQUARE_BAD_REQUEST"],
    [401, "FOURSQUARE_UNAUTHORIZED"],
    [403, "FOURSQUARE_FORBIDDEN"],
    [404, "FOURSQUARE_NOT_FOUND"],
    [422, "FOURSQUARE_UNPROCESSABLE"],
    [429, "FOURSQUARE_RATE_LIMITED"],
    [500, "FOURSQUARE_SERVER_ERROR"],
    [503, "FOURSQUARE_SERVER_ERROR"],
  ] as const)("returns a sanitized controlled error for HTTP %i", async (status, failure) => {
    const { provider } = providerWithResponse(new Response(null, { status }));

    await expect(provider.discover(request())).rejects.toMatchObject({
      code: "DISCOVERY_PROVIDER_FAILED",
      failure,
      status,
    });
  });

  it("does not retain a credential, response body, or headers in an HTTP error", async () => {
    const { provider } = providerWithResponse(new Response("raw response that must not escape", {
      status: 400,
      headers: { "x-external-detail": "must-not-escape" },
    }));

    try {
      await provider.discover(request());
      throw new Error("Expected a Foursquare HTTP error.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "DISCOVERY_PROVIDER_FAILED",
        failure: "FOURSQUARE_BAD_REQUEST",
        status: 400,
      });
      expect(error).not.toHaveProperty("body");
      expect(error).not.toHaveProperty("headers");
      expect(JSON.stringify(error)).not.toContain(testOnlyApiKey);
      expect(JSON.stringify(error)).not.toContain("raw response that must not escape");
      expect(JSON.stringify(error)).not.toContain("must-not-escape");
    }
  });

  it("fails closed for invalid JSON without exposing the source body", async () => {
    const { provider } = providerWithResponse(new Response("{not json", { status: 200 }));

    await expect(provider.discover(request())).rejects.toMatchObject({
      code: "DISCOVERY_INVALID_RESPONSE",
      failure: "FOURSQUARE_INVALID_RESPONSE",
    });
  });

  it("rejects a response whose Content-Length exceeds the bounded body limit", async () => {
    const { provider } = providerWithResponse(new Response("{}", {
      status: 200,
      headers: {
        "content-length": String(maxFoursquareDiscoveryResponseBytes + 1),
      },
    }));

    await expect(provider.discover(request())).rejects.toMatchObject({
      code: "DISCOVERY_LIMIT_EXCEEDED",
      failure: "FOURSQUARE_RESPONSE_TOO_LARGE",
    });
  });

  it("stops incremental body reading when a response exceeds the limit without Content-Length", async () => {
    const oversized = "x".repeat(maxFoursquareDiscoveryResponseBytes + 1);
    const { provider } = providerWithResponse(new Response(oversized, { status: 200 }));

    await expect(provider.discover(request())).rejects.toMatchObject({
      code: "DISCOVERY_LIMIT_EXCEEDED",
      failure: "FOURSQUARE_RESPONSE_TOO_LARGE",
    });
  });

  it("returns a controlled timeout without retrying", async () => {
    const fetchImplementation: FoursquareFetchImplementation = () => new Promise<Response>(() => undefined);
    const provider = new FoursquareScoutDiscoveryProvider({
      fetchImplementation,
      getApiKeyForTesting: () => testOnlyApiKey,
      timeoutMs: 1,
    });

    await expect(provider.discover(request())).rejects.toMatchObject({
      code: "DISCOVERY_PROVIDER_FAILED",
      failure: "FOURSQUARE_TIMEOUT",
    });
  });

  it("sanitizes a rejected transport error without retrying", async () => {
    const sensitiveMessage = `transport failed with ${testOnlyApiKey}`;
    const fetchImplementation = vi.fn(async () => {
      throw new Error(sensitiveMessage);
    });
    const provider = new FoursquareScoutDiscoveryProvider({
      fetchImplementation,
      getApiKeyForTesting: () => testOnlyApiKey,
    });

    try {
      await provider.discover(request());
      throw new Error("Expected a Foursquare network error.");
    } catch (error) {
      expect(error).toMatchObject({
        name: "FoursquareScoutDiscoveryProviderError",
        failure: "FOURSQUARE_NETWORK_ERROR",
        status: undefined,
      });
      expect(error).toHaveProperty("message", "DISCOVERY_PROVIDER_FAILED");
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toContain(sensitiveMessage);
      expect(JSON.stringify(error)).not.toContain(testOnlyApiKey);
    }
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("calls an injected fetch as a detached function rather than with the provider as receiver", async () => {
    const receiverSensitiveFetch: FoursquareFetchImplementation = function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      return Promise.resolve(jsonResponse({ results: [place()] }));
    };
    const provider = new FoursquareScoutDiscoveryProvider({
      fetchImplementation: receiverSensitiveFetch,
      getApiKeyForTesting: () => testOnlyApiKey,
    });

    await expect(provider.discover(request())).resolves.toMatchObject({
      provider: "FOURSQUARE",
      candidates: [expect.objectContaining({ discoveryId: "fsq-atlas" })],
    });
  });

  it("requires the Worker environment credential before making any request", async () => {
    const fetchImplementation = vi.fn(async () => jsonResponse({ results: [] }));
    const provider = new FoursquareScoutDiscoveryProvider({
      fetchImplementation,
      getApiKeyForTesting: () => undefined,
    });

    await expect(provider.discover(request())).rejects.toMatchObject({
      code: "DISCOVERY_PROVIDER_FAILED",
      failure: "FOURSQUARE_CREDENTIAL_REQUIRED",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("fails the whole batch for a candidate that cannot satisfy the Scout candidate schema", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [place({ website: "ftp://not-allowed.example" })],
    }));

    await expect(provider.discover(request())).rejects.toMatchObject({
      code: "DISCOVERY_INVALID_CANDIDATE",
      failure: "FOURSQUARE_INVALID_CANDIDATE",
    });
  });

  it("does not add score, analysis, or evidence to mapped candidates", async () => {
    const { provider } = providerWithResponse(jsonResponse({ results: [place()] }));
    const [candidate] = (await provider.discover(request())).candidates;

    expect(candidate).not.toHaveProperty("qualificationScore");
    expect(candidate).not.toHaveProperty("analysis");
    expect(candidate).not.toHaveProperty("evidence");
  });

  it("composes through the provider port into Scout FOUND without combining responsibilities", async () => {
    const { provider } = providerWithResponse(jsonResponse({ results: [place({ categories: [] })] }));
    const candidates = await discoverScoutCandidates(provider, request());
    const result = runScoutDeterministicSelection({
      criteria: {
        targetLocations: ["Jacarei"],
        targetSegments: ["Contabilidade"],
        requirePublicWebsite: true,
        maxCandidatesToInspect: 10,
      },
      discoveryCandidates: candidates,
      existingLeadReferences: [],
    });

    expect(result.outcome).toBe("FOUND");
    if (result.outcome === "FOUND") {
      expect(result.candidate.source.type).toBe("FOURSQUARE");
      expect(result.candidate.segment).toBe("Contabilidade");
      expect(result.basis).toContain("Discovery candidate matches segment Contabilidade.");
    }
  });

  it("composes through the provider port into Scout NONE for objectively ineligible candidates", async () => {
    const { provider } = providerWithResponse(jsonResponse({
      results: [place({ location: { locality: "Sao Jose dos Campos", region: "SP" } })],
    }));
    const candidates = await discoverScoutCandidates(provider, request());
    const result = runScoutDeterministicSelection({
      criteria: {
        targetLocations: ["Jacarei"],
        targetSegments: ["Contabilidade"],
        requirePublicWebsite: true,
        maxCandidatesToInspect: 10,
      },
      discoveryCandidates: candidates,
      existingLeadReferences: [],
    });

    expect(result).toMatchObject({ outcome: "NONE", reason: "NO_ELIGIBLE_CANDIDATE" });
  });
});
