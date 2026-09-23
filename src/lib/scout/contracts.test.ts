import { describe, expect, it } from "vitest";

import {
  maxScoutDiscoveryCandidates,
  maxScoutExistingLeadReferences,
  maxScoutTargetLocations,
  runScoutDeterministicSelection,
  scoutDiscoveryCandidateSchema,
  scoutInputSchema,
  scoutResultSchema,
} from "./contracts";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    discoveryId: "discovery-atlas",
    companyName: "Atlas Climatizacao",
    city: "Jacarei",
    region: "SP",
    segment: "Climatizacao",
    source: { type: "DIRECTORY", url: "https://directory.example/atlas" },
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    criteria: {
      targetLocations: ["Jacarei"],
      targetSegments: ["Climatizacao"],
      requirePublicWebsite: false,
      maxCandidatesToInspect: 10,
    },
    discoveryCandidates: [candidate()],
    existingLeadReferences: [],
    ...overrides,
  };
}

describe("Scout V0 deterministic contract", () => {
  it("returns one FOUND candidate with factual basis when one record is objectively eligible", () => {
    const result = runScoutDeterministicSelection(input());

    expect(result.outcome).toBe("FOUND");
    if (result.outcome === "FOUND") {
      expect(result.candidate.discoveryId).toBe("discovery-atlas");
      expect(result.basis).toEqual([
        "Discovery record reports city as Jacarei.",
        "Discovery record reports segment as Climatizacao.",
        "Discovery provenance type is DIRECTORY.",
      ]);
      expect(result.unresolvedQuestions).toEqual([]);
    }
  });

  it("returns NONE when no discovery candidates are supplied", () => {
    expect(runScoutDeterministicSelection(input({ discoveryCandidates: [] }))).toEqual({
      outcome: "NONE",
      reason: "NO_DISCOVERY_CANDIDATES",
      unresolvedQuestions: [],
    });
  });

  it("rejects candidates outside target locations or segments", () => {
    expect(runScoutDeterministicSelection(input({
      discoveryCandidates: [candidate({ city: "Sao Jose dos Campos" })],
    })).outcome).toBe("NONE");

    expect(runScoutDeterministicSelection(input({
      discoveryCandidates: [candidate({ segment: "Contabilidade" })],
    })).outcome).toBe("NONE");
  });

  it("requires a website only when the explicit criterion asks for one", () => {
    expect(runScoutDeterministicSelection(input({
      criteria: { ...input().criteria, requirePublicWebsite: true },
      discoveryCandidates: [candidate()],
    })).outcome).toBe("NONE");

    const withWebsite = runScoutDeterministicSelection(input({
      criteria: { ...input().criteria, requirePublicWebsite: true },
      discoveryCandidates: [candidate({ websiteUrl: "https://atlas.example/" })],
    }));
    expect(withWebsite.outcome).toBe("FOUND");
    if (withWebsite.outcome === "FOUND") {
      expect(withWebsite.basis).toContain("A public HTTP(S) website URL was supplied.");
    }
  });

  it("rejects a canonical website URL duplicate of an existing Lead", () => {
    const result = runScoutDeterministicSelection(input({
      discoveryCandidates: [candidate({ websiteUrl: "https://ATLAS.example/#directory" })],
      existingLeadReferences: [{
        id: "lead-atlas",
        companyName: "Different Atlas Name",
        websiteUrl: "https://atlas.example/",
      }],
    }));

    expect(result).toMatchObject({ outcome: "NONE", reason: "NO_ELIGIBLE_CANDIDATE" });
  });

  it("rejects an exact name plus complete location duplicate only when both records lack websites", () => {
    const result = runScoutDeterministicSelection(input({
      discoveryCandidates: [candidate({ companyName: "Vila Verde", city: "Jacarei", region: "SP" })],
      existingLeadReferences: [{
        id: "lead-vila-verde",
        companyName: "VILA   VERDE",
        city: "JACAREI",
        region: "sp",
      }],
    }));

    expect(result).toMatchObject({ outcome: "NONE", reason: "NO_ELIGIBLE_CANDIDATE" });
  });

  it("keeps possible duplicate matches eligible and makes the ambiguity explicit", () => {
    const result = runScoutDeterministicSelection(input({
      discoveryCandidates: [candidate({
        companyName: "Sorriso Prime",
        websiteUrl: "https://sorriso-new.example/",
      })],
      existingLeadReferences: [{
        id: "lead-sorriso-prime",
        companyName: "Sorriso Prime",
        city: "Jacarei",
        region: "SP",
        websiteUrl: "https://sorriso-old.example/",
      }],
    }));

    expect(result.outcome).toBe("FOUND");
    if (result.outcome === "FOUND") {
      expect(result.unresolvedQuestions).toEqual([
        "A possible existing Lead could not be resolved by the V0 deterministic duplicate rule.",
      ]);
      expect(result.basis).not.toContain("A possible existing Lead could not be resolved by the V0 deterministic duplicate rule.");
    }
  });

  it("derives ordered factual basis entries only from active criteria and provenance", () => {
    const result = runScoutDeterministicSelection(input({
      criteria: {
        targetLocations: ["Jacarei", "SP"],
        targetSegments: ["Contabilidade"],
        requirePublicWebsite: true,
        maxCandidatesToInspect: 10,
      },
      discoveryCandidates: [candidate({
        companyName: "Example Accounting",
        city: "Jacarei",
        region: "SP",
        segment: "Contabilidade",
        websiteUrl: "https://example.test",
      })],
    }));

    expect(result.outcome).toBe("FOUND");
    if (result.outcome === "FOUND") {
      expect(result.basis).toEqual([
        "Discovery record reports city as Jacarei and region as SP.",
        "Discovery record reports segment as Contabilidade.",
        "A public HTTP(S) website URL was supplied.",
        "Discovery provenance type is DIRECTORY.",
      ]);
    }
  });

  it("does not invent basis for inactive criteria or commercial analysis", () => {
    const result = runScoutDeterministicSelection(input({
      criteria: { maxCandidatesToInspect: 10 },
      discoveryCandidates: [candidate({ websiteUrl: "https://atlas.example/" })],
    }));

    expect(result.outcome).toBe("FOUND");
    if (result.outcome === "FOUND") {
      expect(result.basis).toEqual(["Discovery provenance type is DIRECTORY."]);
      expect(result.basis.join(" ").toLowerCase()).not.toMatch(
        /score|priority|opportunity|redesign|sales|conversion|demo|good|weak/,
      );
    }
  });

  it("selects the first eligible candidate in original input order without a hidden score", () => {
    const result = runScoutDeterministicSelection(input({
      discoveryCandidates: [
        candidate({ discoveryId: "first", companyName: "Atlas Climatizacao" }),
        candidate({ discoveryId: "second", companyName: "NorteSul" }),
      ],
    }));

    expect(result.outcome).toBe("FOUND");
    if (result.outcome === "FOUND") expect(result.candidate.discoveryId).toBe("first");
  });

  it("inspects only the explicit candidate prefix", () => {
    const result = runScoutDeterministicSelection(input({
      criteria: { ...input().criteria, maxCandidatesToInspect: 1 },
      discoveryCandidates: [
        candidate({ discoveryId: "outside-prefix", city: "Sao Jose dos Campos" }),
        candidate({ discoveryId: "eligible-after-limit", companyName: "NorteSul" }),
      ],
    }));

    expect(result).toMatchObject({ outcome: "NONE", reason: "NO_ELIGIBLE_CANDIDATE" });
  });

  it("returns a schema-valid FOUND shape with exactly one candidate and no score, analysis, or evidence", () => {
    const result = runScoutDeterministicSelection(input());

    expect(scoutResultSchema.parse(result)).toEqual(result);
    expect(result).not.toHaveProperty("candidates");
    expect(result).not.toHaveProperty("qualificationScore");
    expect(result).not.toHaveProperty("analysis");
    expect(result).not.toHaveProperty("evidence");
    expect(result).not.toHaveProperty("demoConcept");
  });

  it("does not mutate discovery or existing-Lead input", () => {
    const scoutInput = input({
      discoveryCandidates: [candidate({ websiteUrl: "https://atlas.example/" })],
      existingLeadReferences: [{
        id: "lead-other",
        companyName: "Other Company",
        city: "Jacarei",
        region: "SP",
      }],
    });
    const before = JSON.stringify(scoutInput);

    runScoutDeterministicSelection(scoutInput);

    expect(JSON.stringify(scoutInput)).toBe(before);
  });

  it("rejects invalid URLs and candidates without provenance", () => {
    expect(scoutInputSchema.safeParse(input({
      discoveryCandidates: [candidate({ websiteUrl: "ftp://atlas.example" })],
    })).success).toBe(false);

    const withoutSource = candidate();
    delete withoutSource.source;
    expect(scoutDiscoveryCandidateSchema.safeParse(withoutSource).success).toBe(false);
  });

  it("enforces candidate and string limits", () => {
    const tooManyCandidates = Array.from({ length: maxScoutDiscoveryCandidates + 1 }, (_, index) => (
      candidate({ discoveryId: `candidate-${index}` })
    ));
    expect(scoutInputSchema.safeParse(input({ discoveryCandidates: tooManyCandidates })).success).toBe(false);
    expect(scoutDiscoveryCandidateSchema.safeParse(candidate({ companyName: "x".repeat(301) })).success).toBe(false);
    expect(scoutInputSchema.safeParse(input({
      criteria: { ...input().criteria, targetLocations: Array(maxScoutTargetLocations + 1).fill("Jacarei") },
    })).success).toBe(false);
    expect(scoutInputSchema.safeParse(input({
      existingLeadReferences: Array.from({ length: maxScoutExistingLeadReferences + 1 }, (_, index) => ({
        id: `lead-${index}`,
        companyName: "Fixture",
      })),
    })).success).toBe(false);
  });
});
