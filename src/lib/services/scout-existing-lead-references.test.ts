import { beforeEach, describe, expect, it, vi } from "vitest";
import { runScoutDeterministicSelection } from "@/lib/scout/contracts";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  leadFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import {
  listScoutExistingLeadReferences,
  ScoutExistingLeadReferenceReadError,
} from "./leads";

const database = { lead: { findMany: mocks.leadFindMany } };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead-1",
    companyName: "Atlas Contabilidade",
    city: "Jacarei",
    region: "SP",
    websiteUrl: "https://atlas.example/",
    ...overrides,
  };
}

function candidate(id: string, name: string, websiteUrl: string) {
  return {
    discoveryId: id,
    companyName: name,
    city: "Jacarei",
    region: "SP",
    segment: "Contabilidade",
    websiteUrl,
    source: { type: "FOURSQUARE" as const },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockReturnValue(database);
  mocks.leadFindMany.mockResolvedValue([]);
});

describe("listScoutExistingLeadReferences", () => {
  it("returns [] for zero CRM Leads through the request-scoped DB boundary", async () => {
    await expect(listScoutExistingLeadReferences()).resolves.toEqual([]);
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
  });

  it("selects and returns only the five minimum duplicate-reference fields", async () => {
    mocks.leadFindMany.mockResolvedValue([row({
      qualificationScore: 10,
      notes: "Private note",
      email: "private@example.test",
      activities: [{ id: "activity-1" }],
      analysis: { id: "analysis-1" },
    })]);

    await expect(listScoutExistingLeadReferences()).resolves.toEqual([{
      id: "lead-1",
      companyName: "Atlas Contabilidade",
      city: "Jacarei",
      region: "SP",
      websiteUrl: "https://atlas.example/",
    }]);
    expect(mocks.leadFindMany).toHaveBeenCalledWith({
      select: {
        id: true,
        companyName: true,
        city: true,
        region: true,
        websiteUrl: true,
      },
      orderBy: { id: "asc" },
      take: 501,
    });
  });

  it("keeps optional city, region, and website absent when the CRM stores null", async () => {
    mocks.leadFindMany.mockResolvedValue([row({
      city: null,
      region: null,
      websiteUrl: null,
    })]);

    await expect(listScoutExistingLeadReferences()).resolves.toEqual([{
      id: "lead-1",
      companyName: "Atlas Contabilidade",
    }]);
  });

  it("fails closed when a CRM row cannot satisfy ScoutExistingLeadReference", async () => {
    mocks.leadFindMany.mockResolvedValue([row({ companyName: "" })]);

    await expect(listScoutExistingLeadReferences()).rejects.toEqual(
      new ScoutExistingLeadReferenceReadError("SCOUT_EXISTING_LEAD_REFERENCE_INVALID"),
    );
  });

  it("fails explicitly rather than silently truncating more than 500 references", async () => {
    mocks.leadFindMany.mockResolvedValue(Array.from({ length: 501 }, (_, index) => row({
      id: `lead-${index + 1}`,
      companyName: `Synthetic Lead ${index + 1}`,
    })));

    await expect(listScoutExistingLeadReferences()).rejects.toEqual(
      new ScoutExistingLeadReferenceReadError("SCOUT_EXISTING_LEAD_REFERENCE_LIMIT_EXCEEDED"),
    );
  });

  it("sanitizes a Prisma/D1 read failure without retaining its raw message", async () => {
    const sensitiveMessage = "Prisma D1 failed for private-lead@example.test";
    mocks.leadFindMany.mockRejectedValue(new Error(sensitiveMessage));

    try {
      await listScoutExistingLeadReferences();
      throw new Error("Expected the Scout CRM read to fail.");
    } catch (error) {
      expect(error).toEqual(
        new ScoutExistingLeadReferenceReadError("SCOUT_EXISTING_LEAD_REFERENCE_READ_FAILED"),
      );
      expect(error).toHaveProperty("message", "SCOUT_EXISTING_LEAD_REFERENCE_READ_FAILED");
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toContain(sensitiveMessage);
    }
  });
});

describe("Scout duplicate composition with CRM references", () => {
  const criteria = {
    targetLocations: ["Jacarei", "SP"],
    targetSegments: ["Contabilidade"],
    requirePublicWebsite: false,
    maxCandidatesToInspect: 10,
  };

  it("skips duplicate candidate A and selects eligible candidate B", () => {
    const result = runScoutDeterministicSelection({
      criteria,
      discoveryCandidates: [
        candidate("fsq-a", "Atlas Contabilidade", "https://atlas.example/"),
        candidate("fsq-b", "Boreal Contabilidade", "https://boreal.example/"),
      ],
      existingLeadReferences: [row()],
    });

    expect(result).toMatchObject({
      outcome: "FOUND",
      candidate: { discoveryId: "fsq-b", companyName: "Boreal Contabilidade" },
    });
  });

  it("returns NONE when every eligible candidate is an exact CRM duplicate", () => {
    const result = runScoutDeterministicSelection({
      criteria,
      discoveryCandidates: [
        candidate("fsq-a", "Atlas Contabilidade", "https://atlas.example/"),
        candidate("fsq-b", "Boreal Contabilidade", "https://boreal.example/"),
      ],
      existingLeadReferences: [
        row(),
        row({
          id: "lead-2",
          companyName: "Boreal Contabilidade",
          websiteUrl: "https://boreal.example/",
        }),
      ],
    });

    expect(result).toEqual({
      outcome: "NONE",
      reason: "NO_ELIGIBLE_CANDIDATE",
      unresolvedQuestions: [],
    });
  });
});
