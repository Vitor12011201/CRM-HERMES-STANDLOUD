import { describe, expect, it } from "vitest";

import { runScoutDeterministicSelection } from "./contracts";
import {
  discoverScoutCandidates,
  InMemoryScoutDiscoveryProvider,
  maxScoutDiscoveryProviderLocations,
  ScoutDiscoveryProviderError,
  scoutDiscoveryProviderNameSchema,
  scoutDiscoveryRequestSchema,
  type ScoutDiscoveryProvider,
  type ScoutDiscoveryProviderResult,
} from "./discovery-provider";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    discoveryId: "discovery-atlas",
    companyName: "Atlas Climatizacao",
    city: "Jacarei",
    region: "SP",
    segment: "Climatizacao",
    websiteUrl: "https://atlas.example/",
    source: { type: "DIRECTORY", url: "https://directory.example/atlas" },
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    targetLocations: [{ city: "Jacarei", region: "SP" }],
    targetSegments: ["Climatizacao"],
    limit: 20,
    ...overrides,
  };
}

function providerReturning(result: unknown): ScoutDiscoveryProvider {
  return {
    provider: "SYNTHETIC",
    async discover() {
      return result as ScoutDiscoveryProviderResult;
    },
  };
}

describe("Scout Discovery Provider V0", () => {
  it("keeps the provider-name contract explicit for SYNTHETIC and FOURSQUARE", () => {
    expect(scoutDiscoveryRequestSchema.safeParse(request()).success).toBe(true);
    expect(scoutDiscoveryProviderNameSchema.safeParse("SYNTHETIC").success).toBe(true);
    expect(scoutDiscoveryProviderNameSchema.safeParse("FOURSQUARE").success).toBe(true);
    expect(scoutDiscoveryProviderNameSchema.safeParse("RANDOM").success).toBe(false);
  });

  it("returns one valid candidate through the fake provider", async () => {
    const candidates = await discoverScoutCandidates(
      new InMemoryScoutDiscoveryProvider([candidate()]),
      request(),
    );

    expect(candidates).toEqual([candidate()]);
  });

  it("preserves source order, including source duplicates", async () => {
    const fixtures = [
      candidate({ discoveryId: "first", companyName: "Atlas Climatizacao" }),
      candidate({ discoveryId: "second", companyName: "Atlas Climatizacao" }),
      candidate({ discoveryId: "third", companyName: "NorteSul" }),
    ];
    const candidates = await discoverScoutCandidates(new InMemoryScoutDiscoveryProvider(fixtures), request());

    expect(candidates.map(({ discoveryId }) => discoveryId)).toEqual(["first", "second", "third"]);
    expect(candidates).toHaveLength(3);
  });

  it("accepts an empty valid provider result", async () => {
    await expect(discoverScoutCandidates(new InMemoryScoutDiscoveryProvider([]), request())).resolves.toEqual([]);
  });

  it.each([
    ["missing companyName", candidate({ companyName: undefined })],
    ["missing discoveryId", candidate({ discoveryId: undefined })],
    ["missing provenance", candidate({ source: undefined })],
    ["invalid URL", candidate({ websiteUrl: "ftp://atlas.example" })],
  ])("fails closed for an invalid candidate: %s", async (_label, invalidCandidate) => {
    await expect(discoverScoutCandidates(providerReturning({
      provider: "SYNTHETIC",
      candidates: [invalidCandidate],
    }), request())).rejects.toEqual(new ScoutDiscoveryProviderError("DISCOVERY_INVALID_CANDIDATE"));
  });

  it("fails closed when a provider returns more than fifty candidates", async () => {
    const candidates = Array.from({ length: 51 }, (_, index) => candidate({ discoveryId: `candidate-${index}` }));

    await expect(discoverScoutCandidates(providerReturning({ provider: "SYNTHETIC", candidates }), request()))
      .rejects.toEqual(new ScoutDiscoveryProviderError("DISCOVERY_LIMIT_EXCEEDED"));
  });

  it("rejects a request whose limit exceeds the Scout maximum", async () => {
    expect(scoutDiscoveryRequestSchema.safeParse(request({ limit: 51 })).success).toBe(false);
    await expect(discoverScoutCandidates(new InMemoryScoutDiscoveryProvider([]), request({ limit: 51 })))
      .rejects.toEqual(new ScoutDiscoveryProviderError("DISCOVERY_INVALID_REQUEST"));
  });

  it("converts provider exceptions into a sanitized boundary error", async () => {
    const provider: ScoutDiscoveryProvider = {
      provider: "SYNTHETIC",
      async discover() {
        throw new Error("raw provider credential or transport detail");
      },
    };

    await expect(discoverScoutCandidates(provider, request()))
      .rejects.toEqual(new ScoutDiscoveryProviderError("DISCOVERY_PROVIDER_FAILED"));
  });

  it("fails the complete operation when an invalid candidate appears between valid records", async () => {
    await expect(discoverScoutCandidates(providerReturning({
      provider: "SYNTHETIC",
      candidates: [candidate({ discoveryId: "valid-first" }), candidate({ source: undefined }), candidate({ discoveryId: "valid-last" })],
    }), request())).rejects.toEqual(new ScoutDiscoveryProviderError("DISCOVERY_INVALID_CANDIDATE"));
  });

  it("does not add score, analysis, or evidence and does not mutate fixture input", async () => {
    const fixtures = [candidate()];
    const before = JSON.stringify(fixtures);
    const provider = new InMemoryScoutDiscoveryProvider(fixtures);
    const candidates = await discoverScoutCandidates(provider, request());

    expect(JSON.stringify(fixtures)).toBe(before);
    expect(candidates[0]).not.toHaveProperty("qualificationScore");
    expect(candidates[0]).not.toHaveProperty("analysis");
    expect(candidates[0]).not.toHaveProperty("evidence");

    candidates[0].companyName = "Caller mutation";
    expect((await discoverScoutCandidates(provider, request()))[0].companyName).toBe("Atlas Climatizacao");
  });

  it("composes with Scout V0 in memory without merging responsibilities", async () => {
    const candidates = await discoverScoutCandidates(new InMemoryScoutDiscoveryProvider([candidate()]), request());
    const result = runScoutDeterministicSelection({
      criteria: {
        targetLocations: ["Jacarei"],
        targetSegments: ["Climatizacao"],
        requirePublicWebsite: true,
        maxCandidatesToInspect: 10,
      },
      discoveryCandidates: candidates,
      existingLeadReferences: [],
    });

    expect(result.outcome).toBe("FOUND");
  });

  it("composes with Scout V0 to NONE when source candidates are ineligible", async () => {
    const candidates = await discoverScoutCandidates(new InMemoryScoutDiscoveryProvider([
      candidate({ city: "Sao Jose dos Campos" }),
    ]), request());
    const result = runScoutDeterministicSelection({
      criteria: {
        targetLocations: ["Jacarei"],
        targetSegments: ["Climatizacao"],
        requirePublicWebsite: true,
        maxCandidatesToInspect: 10,
      },
      discoveryCandidates: candidates,
      existingLeadReferences: [],
    });

    expect(result).toMatchObject({ outcome: "NONE", reason: "NO_ELIGIBLE_CANDIDATE" });
  });

  it("enforces objective request arrays and rejects subjective request fields", () => {
    expect(scoutDiscoveryRequestSchema.safeParse(request({
      targetLocations: Array(maxScoutDiscoveryProviderLocations + 1).fill({ city: "Jacarei" }),
    })).success).toBe(false);
    expect(scoutDiscoveryRequestSchema.safeParse({
      ...request(),
      highValueProspects: true,
    }).success).toBe(false);
  });
});
