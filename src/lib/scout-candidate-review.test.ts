import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import {
  claimScoutCandidateReviewForApproval,
  findLeadByScoutProvenance,
  getScoutCandidateReview,
  listPendingScoutCandidateReviews,
  listSeenScoutDiscoveryIdentities,
  markScoutCandidateReviewConverted,
  persistScoutCandidateReview,
  rejectScoutCandidateReview,
  toScoutFoundResult,
  type ScoutCandidateReviewStore,
} from "./scout-candidate-review";
import { scoutFoundResultSchema, type ScoutResult } from "./scout/contracts";

type StorageRow = NonNullable<Awaited<ReturnType<ScoutCandidateReviewStore["findById"]>>>;
type CreateInput = Parameters<ScoutCandidateReviewStore["create"]>[0];
type CompareAndSetInput = Parameters<ScoutCandidateReviewStore["compareAndSet"]>[2];

function foundResult(overrides: Partial<ScoutResult> = {}): ScoutResult {
  return {
    outcome: "FOUND",
    candidate: {
      discoveryId: "fsq-123",
      companyName: "Atlas Contabilidade",
      city: "Jacareí",
      region: "SP",
      segment: "Contabilidade",
      websiteUrl: "https://atlas.example.com",
      source: {
        type: "FOURSQUARE",
        url: "https://foursquare.com/v/fsq-123",
      },
    },
    basis: ["First factual basis.", "Second factual basis."],
    unresolvedQuestions: ["Does it have a public contact channel?"],
    ...overrides,
  } as ScoutResult;
}

class InMemoryScoutCandidateReviewStore implements ScoutCandidateReviewStore {
  readonly rows: StorageRow[] = [];
  readonly provenanceSources: string[] = [];
  createCount = 0;

  async findByIdentity(sourceType: "GOOGLE_MAPS" | "WEBSITE" | "DIRECTORY" | "FOURSQUARE" | "OTHER", discoveryId: string) {
    return this.rows.find((row) => row.sourceType === sourceType && row.discoveryId === discoveryId) ?? null;
  }

  async create(input: CreateInput): Promise<StorageRow> {
    this.createCount += 1;
    if (await this.findByIdentity(input.sourceType, input.discoveryId)) {
      throw { code: "P2002" };
    }
    const now = new Date(`2026-09-23T00:00:0${this.rows.length}Z`);
    const row: StorageRow = {
      id: `review-${this.rows.length + 1}`,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async findById(id: string) {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async listPending() {
    return this.rows
      .filter((row) => row.status === "PENDING")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async listSeenIdentities() {
    return this.rows.map((row) => ({
      sourceType: row.sourceType,
      discoveryId: row.discoveryId,
    }));
  }

  async compareAndSet(
    id: string,
    expectedStatus: StorageRow["status"],
    input: CompareAndSetInput,
  ): Promise<{ count: number }> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.status !== expectedStatus) return { count: 0 };
    Object.assign(row, input, { updatedAt: new Date("2026-09-23T01:00:00Z") });
    return { count: 1 };
  }

  async findLeadIdBySource(source: string) {
    this.provenanceSources.push(source);
    return source === "SCOUT:FOURSQUARE:fsq-123" ? { id: "lead-123" } : null;
  }
}

describe("Scout candidate review persistence", () => {
  it("rejects NONE before any persisted candidate can be created", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const none: ScoutResult = {
      outcome: "NONE",
      reason: "NO_ELIGIBLE_CANDIDATE",
      unresolvedQuestions: [],
    };

    await expect(persistScoutCandidateReview(none, store)).rejects.toMatchObject({
      code: "SCOUT_REVIEW_RESULT_NOT_FOUND",
    });
    expect(store.createCount).toBe(0);
  });

  it("persists only FOUND facts, preserving source URL and array order as PENDING", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const persisted = await persistScoutCandidateReview(foundResult(), store);

    expect(persisted.created).toBe(true);
    expect(persisted.review).toMatchObject({
      discoveryId: "fsq-123",
      companyName: "Atlas Contabilidade",
      city: "Jacareí",
      region: "SP",
      segment: "Contabilidade",
      websiteUrl: "https://atlas.example.com",
      source: {
        type: "FOURSQUARE",
        url: "https://foursquare.com/v/fsq-123",
      },
      basis: ["First factual basis.", "Second factual basis."],
      unresolvedQuestions: ["Does it have a public contact channel?"],
      status: "PENDING",
    });
    expect(Object.keys(persisted.review).sort()).toEqual([
      "basis",
      "city",
      "companyName",
      "createdAt",
      "discoveryId",
      "id",
      "region",
      "segment",
      "source",
      "status",
      "unresolvedQuestions",
      "updatedAt",
      "websiteUrl",
    ]);
  });

  it("preserves an absent optional source URL", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const result = foundResult();
    if (result.outcome !== "FOUND") throw new Error("test setup");
    delete result.candidate.source.url;

    const persisted = await persistScoutCandidateReview(result, store);
    expect(persisted.review.source).toEqual({ type: "FOURSQUARE" });
  });

  it("uses source type plus discovery ID as the persisted identity", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const first = await persistScoutCandidateReview(foundResult(), store);
    const second = await persistScoutCandidateReview(foundResult(), store);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.review.id).toBe(first.review.id);
    expect(store.createCount).toBe(1);
  });

  it("fails closed when persisted JSON is corrupted", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    await persistScoutCandidateReview(foundResult(), store);
    store.rows[0].basisJson = "{not JSON";

    await expect(getScoutCandidateReview("review-1", store)).rejects.toMatchObject({
      code: "SCOUT_REVIEW_STORAGE_INVALID",
    });
  });

  it("reconstructs a valid Scout FOUND result from the persisted review", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const persisted = await persistScoutCandidateReview(foundResult(), store);
    const reconstructed = toScoutFoundResult(persisted.review);

    expect(scoutFoundResultSchema.parse(reconstructed)).toEqual(reconstructed);
    expect(reconstructed).toMatchObject({
      outcome: "FOUND",
      candidate: { discoveryId: "fsq-123", source: { type: "FOURSQUARE" } },
    });
  });

  it("lists pending reviews in FIFO createdAt order", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    await persistScoutCandidateReview(foundResult(), store);
    const second = foundResult();
    if (second.outcome !== "FOUND") throw new Error("test setup");
    second.candidate.discoveryId = "fsq-456";
    second.candidate.companyName = "Vila Verde";
    await persistScoutCandidateReview(second, store);

    await expect(listPendingScoutCandidateReviews(store)).resolves.toMatchObject([
      { discoveryId: "fsq-123" },
      { discoveryId: "fsq-456" },
    ]);
  });

  it("transitions PENDING to REJECTED and makes the same rejection idempotent", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const { review } = await persistScoutCandidateReview(foundResult(), store);

    const rejected = await rejectScoutCandidateReview(review.id, store, new Date("2026-09-23T02:00:00Z"));
    const retried = await rejectScoutCandidateReview(review.id, store);

    expect(rejected).toMatchObject({ changed: true, review: { status: "REJECTED" } });
    expect(retried).toMatchObject({ changed: false, review: { status: "REJECTED" } });
  });

  it("keeps REJECTED when reject wins the CAS and an approval claim loses", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const { review } = await persistScoutCandidateReview(foundResult(), store);

    await expect(rejectScoutCandidateReview(review.id, store)).resolves
      .toMatchObject({ changed: true, review: { status: "REJECTED" } });
    await expect(claimScoutCandidateReviewForApproval(review.id, store)).rejects
      .toMatchObject({ code: "SCOUT_REVIEW_INVALID_STATE" });
    await expect(getScoutCandidateReview(review.id, store)).resolves
      .toMatchObject({ status: "REJECTED" });
  });

  it("keeps APPROVING when the approval claim wins the CAS and reject loses", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const { review } = await persistScoutCandidateReview(foundResult(), store);

    await expect(claimScoutCandidateReviewForApproval(review.id, store)).resolves
      .toMatchObject({ changed: true, review: { status: "APPROVING" } });
    await expect(rejectScoutCandidateReview(review.id, store)).rejects
      .toMatchObject({ code: "SCOUT_REVIEW_INVALID_STATE" });
    await expect(getScoutCandidateReview(review.id, store)).resolves
      .toMatchObject({ status: "APPROVING" });
  });

  it("makes an APPROVING claim retry idempotent without a last-write-wins update", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const { review } = await persistScoutCandidateReview(foundResult(), store);

    const claimed = await claimScoutCandidateReviewForApproval(review.id, store);
    const retried = await claimScoutCandidateReviewForApproval(review.id, store);

    expect(claimed).toMatchObject({ changed: true, review: { status: "APPROVING" } });
    expect(retried).toMatchObject({ changed: false, review: { status: "APPROVING" } });
    expect(store.rows[0].status).toBe("APPROVING");
  });

  it("rejects a direct PENDING to CONVERTED transition", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const { review } = await persistScoutCandidateReview(foundResult(), store);

    await expect(markScoutCandidateReviewConverted(review.id, "lead-1", store)).rejects
      .toMatchObject({ code: "SCOUT_REVIEW_INVALID_STATE" });
    await expect(getScoutCandidateReview(review.id, store)).resolves
      .toMatchObject({ status: "PENDING" });
  });

  it("claims PENDING for approval before converting and makes the same conversion idempotent", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const { review } = await persistScoutCandidateReview(foundResult(), store);

    const claimed = await claimScoutCandidateReviewForApproval(
      review.id,
      store,
      new Date("2026-09-23T02:00:00Z"),
    );
    const converted = await markScoutCandidateReviewConverted(review.id, "lead-1", store);
    const retried = await markScoutCandidateReviewConverted(review.id, "lead-1", store);

    expect(claimed).toMatchObject({ changed: true, review: { status: "APPROVING" } });
    expect(converted).toMatchObject({
      changed: true,
      review: { status: "CONVERTED", leadId: "lead-1" },
    });
    expect(retried).toMatchObject({
      changed: false,
      review: { status: "CONVERTED", leadId: "lead-1" },
    });
    expect(converted.review.reviewedAt).toEqual(new Date("2026-09-23T02:00:00Z"));
  });

  it("fails closed for invalid review state transitions and conflicting Lead ids", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const rejected = await persistScoutCandidateReview(foundResult(), store);
    await rejectScoutCandidateReview(rejected.review.id, store);
    await expect(markScoutCandidateReviewConverted(rejected.review.id, "lead-1", store)).rejects
      .toMatchObject({ code: "SCOUT_REVIEW_INVALID_STATE" });

    const convertedResult = foundResult();
    if (convertedResult.outcome !== "FOUND") throw new Error("test setup");
    convertedResult.candidate.discoveryId = "fsq-456";
    const converted = await persistScoutCandidateReview(convertedResult, store);
    await claimScoutCandidateReviewForApproval(converted.review.id, store);
    await markScoutCandidateReviewConverted(converted.review.id, "lead-1", store);
    await expect(markScoutCandidateReviewConverted(converted.review.id, "lead-2", store)).rejects
      .toMatchObject({ code: "SCOUT_REVIEW_INVALID_STATE" });
    await expect(rejectScoutCandidateReview(converted.review.id, store)).rejects
      .toMatchObject({ code: "SCOUT_REVIEW_INVALID_STATE" });
    await expect(claimScoutCandidateReviewForApproval(converted.review.id, store)).rejects
      .toMatchObject({ code: "SCOUT_REVIEW_INVALID_STATE" });
  });

  it.each([
    {
      name: "PENDING with leadId",
      mutate: (row: StorageRow) => { row.leadId = "lead-1"; },
    },
    {
      name: "PENDING with reviewedAt",
      mutate: (row: StorageRow) => { row.reviewedAt = new Date("2026-09-23T02:00:00Z"); },
    },
    {
      name: "APPROVING without reviewedAt",
      mutate: (row: StorageRow) => { row.status = "APPROVING"; },
    },
    {
      name: "APPROVING with leadId",
      mutate: (row: StorageRow) => {
        row.status = "APPROVING";
        row.reviewedAt = new Date("2026-09-23T02:00:00Z");
        row.leadId = "lead-1";
      },
    },
    {
      name: "REJECTED without reviewedAt",
      mutate: (row: StorageRow) => { row.status = "REJECTED"; },
    },
    {
      name: "REJECTED with leadId",
      mutate: (row: StorageRow) => {
        row.status = "REJECTED";
        row.reviewedAt = new Date("2026-09-23T02:00:00Z");
        row.leadId = "lead-1";
      },
    },
    {
      name: "CONVERTED without leadId",
      mutate: (row: StorageRow) => {
        row.status = "CONVERTED";
        row.reviewedAt = new Date("2026-09-23T02:00:00Z");
      },
    },
    {
      name: "CONVERTED without reviewedAt",
      mutate: (row: StorageRow) => {
        row.status = "CONVERTED";
        row.leadId = "lead-1";
      },
    },
  ])("fails closed for invalid persisted state: $name", async ({ mutate }) => {
    const store = new InMemoryScoutCandidateReviewStore();
    await persistScoutCandidateReview(foundResult(), store);
    mutate(store.rows[0]);

    await expect(getScoutCandidateReview("review-1", store)).rejects.toMatchObject({
      code: "SCOUT_REVIEW_STORAGE_INVALID",
    });
  });

  it("returns all seen identities regardless of review status", async () => {
    const store = new InMemoryScoutCandidateReviewStore();
    const pending = await persistScoutCandidateReview(foundResult(), store);
    const rejected = foundResult();
    if (rejected.outcome !== "FOUND") throw new Error("test setup");
    rejected.candidate.discoveryId = "fsq-456";
    const rejectedReview = await persistScoutCandidateReview(rejected, store);
    await rejectScoutCandidateReview(rejectedReview.review.id, store);
    const converted = foundResult();
    if (converted.outcome !== "FOUND") throw new Error("test setup");
    converted.candidate.discoveryId = "fsq-789";
    const convertedReview = await persistScoutCandidateReview(converted, store);
    await claimScoutCandidateReviewForApproval(convertedReview.review.id, store);
    await markScoutCandidateReviewConverted(convertedReview.review.id, "lead-789", store);

    await expect(listSeenScoutDiscoveryIdentities(store)).resolves.toEqual([
      { sourceType: "FOURSQUARE", discoveryId: pending.review.discoveryId },
      { sourceType: "FOURSQUARE", discoveryId: "fsq-456" },
      { sourceType: "FOURSQUARE", discoveryId: "fsq-789" },
    ]);
  });

  it("looks up a Lead using only the exact Scout provenance source", async () => {
    const store = new InMemoryScoutCandidateReviewStore();

    await expect(findLeadByScoutProvenance("FOURSQUARE", "fsq-123", store)).resolves
      .toEqual({ id: "lead-123" });
    expect(store.provenanceSources).toEqual(["SCOUT:FOURSQUARE:fsq-123"]);
  });
});
