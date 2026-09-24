import { z } from "zod";

import { getDb, type DbClient } from "@/lib/db";
import {
  scoutDiscoverySourceSchema,
  scoutDiscoverySourceTypeSchema,
  scoutDiscoveryCandidateSchema,
  scoutFoundResultSchema,
  scoutResultSchema,
  type ScoutDiscoverySource,
  type ScoutDiscoverySourceType,
  type ScoutFoundResult,
  type ScoutResult,
} from "@/lib/scout/contracts";

export const scoutCandidateReviewStatusSchema = z.enum([
  "PENDING",
  "APPROVING",
  "REJECTED",
  "CONVERTED",
]);

export type ScoutCandidateReviewStatus = z.infer<typeof scoutCandidateReviewStatusSchema>;

export type ScoutCandidateReview = Readonly<{
  id: string;
  discoveryId: string;
  companyName: string;
  city?: string;
  region?: string;
  segment?: string;
  websiteUrl?: string;
  source: ScoutDiscoverySource;
  basis: string[];
  unresolvedQuestions: string[];
  status: ScoutCandidateReviewStatus;
  leadId?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}>;

type ScoutCandidateReviewStorageRecord = {
  id: string;
  discoveryId: string;
  companyName: string;
  city: string | null;
  region: string | null;
  segment: string | null;
  websiteUrl: string | null;
  sourceType: string;
  sourceUrl: string | null;
  basisJson: string;
  unresolvedQuestionsJson: string;
  status: string;
  leadId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ScoutCandidateReviewStorageCreateInput = Omit<
  ScoutCandidateReviewStorageRecord,
  "id" | "createdAt" | "updatedAt"
>;

type ScoutCandidateReviewCompareAndSetInput = {
  status: ScoutCandidateReviewStatus;
  leadId?: string;
  reviewedAt?: Date | null;
};

export type ScoutCandidateReviewStore = {
  findByIdentity(
    sourceType: ScoutDiscoverySourceType,
    discoveryId: string,
  ): Promise<ScoutCandidateReviewStorageRecord | null>;
  create(
    input: ScoutCandidateReviewStorageCreateInput,
  ): Promise<ScoutCandidateReviewStorageRecord>;
  findById(id: string): Promise<ScoutCandidateReviewStorageRecord | null>;
  listPending(): Promise<ScoutCandidateReviewStorageRecord[]>;
  listActionable(): Promise<ScoutCandidateReviewStorageRecord[]>;
  listSeenIdentities(): Promise<Array<{ sourceType: string; discoveryId: string }>>;
  compareAndSet(
    id: string,
    expectedStatus: ScoutCandidateReviewStatus,
    input: ScoutCandidateReviewCompareAndSetInput,
  ): Promise<{ count: number }>;
  findLeadIdBySource(source: string): Promise<{ id: string } | null>;
};

export type PersistScoutCandidateReviewResult = Readonly<{
  review: ScoutCandidateReview;
  created: boolean;
}>;

export type ScoutCandidateReviewTransitionResult = Readonly<{
  review: ScoutCandidateReview;
  changed: boolean;
}>;

/** A successful approval claim deliberately carries no post-write row read. */
export type ScoutCandidateReviewApprovalClaimResult =
  | Readonly<{ changed: true }>
  | Readonly<{ changed: false; review: ScoutCandidateReview }>;

export class ScoutCandidateReviewError extends Error {
  constructor(
    public readonly code:
      | "SCOUT_REVIEW_RESULT_NOT_FOUND"
      | "SCOUT_REVIEW_NOT_FOUND"
      | "SCOUT_REVIEW_INVALID_STATE"
      | "SCOUT_REVIEW_STORAGE_INVALID"
      | "SCOUT_REVIEW_DUPLICATE_IDENTITY",
  ) {
    super(code);
    this.name = "ScoutCandidateReviewError";
  }
}

const storageRecordSchema = z.object({
  id: z.string().trim().min(1),
  discoveryId: z.string().trim().min(1).max(128),
  companyName: z.string().trim().min(1).max(300),
  city: z.string().nullable(),
  region: z.string().nullable(),
  segment: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  sourceType: scoutDiscoverySourceTypeSchema,
  sourceUrl: z.string().nullable(),
  basisJson: z.string(),
  unresolvedQuestionsJson: z.string(),
  status: scoutCandidateReviewStatusSchema,
  leadId: z.string().trim().min(1).nullable(),
  reviewedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();

const seenIdentitySchema = z.object({
  sourceType: scoutDiscoverySourceTypeSchema,
  discoveryId: z.string().trim().min(1).max(128),
}).strict();

const leadIdSchema = z.string().trim().min(1).max(64);

type ScoutCandidateReviewDb = Pick<DbClient, "scoutCandidateReview" | "lead">;

function storageInvalid(): ScoutCandidateReviewError {
  return new ScoutCandidateReviewError("SCOUT_REVIEW_STORAGE_INVALID");
}

function parseJsonArray(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw storageInvalid();
  }
}

function parseStoredReview(record: unknown): ScoutCandidateReview {
  const parsed = storageRecordSchema.safeParse(record);
  if (!parsed.success) throw storageInvalid();

  const source = scoutDiscoverySourceSchema.safeParse({
    type: parsed.data.sourceType,
    ...(parsed.data.sourceUrl === null ? {} : { url: parsed.data.sourceUrl }),
  });
  if (!source.success) throw storageInvalid();

  const found = scoutFoundResultSchema.safeParse({
    outcome: "FOUND",
    candidate: {
      discoveryId: parsed.data.discoveryId,
      companyName: parsed.data.companyName,
      ...(parsed.data.city === null ? {} : { city: parsed.data.city }),
      ...(parsed.data.region === null ? {} : { region: parsed.data.region }),
      ...(parsed.data.segment === null ? {} : { segment: parsed.data.segment }),
      ...(parsed.data.websiteUrl === null ? {} : { websiteUrl: parsed.data.websiteUrl }),
      source: source.data,
    },
    basis: parseJsonArray(parsed.data.basisJson),
    unresolvedQuestions: parseJsonArray(parsed.data.unresolvedQuestionsJson),
  });
  if (!found.success) throw storageInvalid();

  const hasLeadId = parsed.data.leadId !== null;
  const hasReviewedAt = parsed.data.reviewedAt !== null;
  const hasValidStateFields = (parsed.data.status === "PENDING" && !hasLeadId && !hasReviewedAt)
    || (parsed.data.status === "APPROVING" && !hasLeadId && hasReviewedAt)
    || (parsed.data.status === "REJECTED" && !hasLeadId && hasReviewedAt)
    || (parsed.data.status === "CONVERTED" && hasLeadId && hasReviewedAt);
  if (!hasValidStateFields) throw storageInvalid();

  return {
    id: parsed.data.id,
    discoveryId: found.data.candidate.discoveryId,
    companyName: found.data.candidate.companyName,
    ...(found.data.candidate.city === undefined ? {} : { city: found.data.candidate.city }),
    ...(found.data.candidate.region === undefined ? {} : { region: found.data.candidate.region }),
    ...(found.data.candidate.segment === undefined ? {} : { segment: found.data.candidate.segment }),
    ...(found.data.candidate.websiteUrl === undefined
      ? {}
      : { websiteUrl: found.data.candidate.websiteUrl }),
    source: found.data.candidate.source,
    basis: found.data.basis,
    unresolvedQuestions: found.data.unresolvedQuestions,
    status: parsed.data.status,
    ...(parsed.data.leadId === null ? {} : { leadId: parsed.data.leadId }),
    ...(parsed.data.reviewedAt === null ? {} : { reviewedAt: parsed.data.reviewedAt }),
    createdAt: parsed.data.createdAt,
    updatedAt: parsed.data.updatedAt,
  };
}

function parseFoundScoutResult(result: ScoutResult): ScoutFoundResult {
  const parsed = scoutResultSchema.safeParse(result);
  if (!parsed.success || parsed.data.outcome !== "FOUND") {
    throw new ScoutCandidateReviewError("SCOUT_REVIEW_RESULT_NOT_FOUND");
  }
  return parsed.data;
}

function toStorageCreateInput(result: ScoutFoundResult): ScoutCandidateReviewStorageCreateInput {
  const candidate = result.candidate;
  return {
    discoveryId: candidate.discoveryId,
    companyName: candidate.companyName,
    city: candidate.city ?? null,
    region: candidate.region ?? null,
    segment: candidate.segment ?? null,
    websiteUrl: candidate.websiteUrl ?? null,
    sourceType: candidate.source.type,
    sourceUrl: candidate.source.url ?? null,
    basisJson: JSON.stringify(result.basis),
    unresolvedQuestionsJson: JSON.stringify(result.unresolvedQuestions),
    status: "PENDING",
    leadId: null,
    reviewedAt: null,
  };
}

function isUniqueIdentityError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "P2002";
}

function isReviewError(error: unknown): error is ScoutCandidateReviewError {
  return error instanceof ScoutCandidateReviewError;
}

async function sanitizeStorageRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isReviewError(error)) throw error;
    throw storageInvalid();
  }
}

export function createScoutCandidateReviewStore(db: ScoutCandidateReviewDb): ScoutCandidateReviewStore {
  return {
    findByIdentity: (sourceType, discoveryId) => db.scoutCandidateReview.findUnique({
      where: { sourceType_discoveryId: { sourceType, discoveryId } },
    }),
    create: (input) => db.scoutCandidateReview.create({ data: input }),
    findById: (id) => db.scoutCandidateReview.findUnique({ where: { id } }),
    listPending: () => db.scoutCandidateReview.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    }),
    listActionable: () => db.scoutCandidateReview.findMany({
      where: { status: { in: ["PENDING", "APPROVING"] } },
      orderBy: { createdAt: "asc" },
    }),
    listSeenIdentities: () => db.scoutCandidateReview.findMany({
      select: { sourceType: true, discoveryId: true },
      orderBy: { createdAt: "asc" },
    }),
    compareAndSet: (id, expectedStatus, input) => db.scoutCandidateReview.updateMany({
      where: { id, status: expectedStatus },
      data: input,
    }),
    findLeadIdBySource: (source) => db.lead.findFirst({
      where: { source },
      select: { id: true },
    }),
  };
}

function liveStore(): ScoutCandidateReviewStore {
  return createScoutCandidateReviewStore(getDb());
}

/** Persists one validated Scout FOUND result as a FIFO human-review candidate. */
export async function persistScoutCandidateReview(
  result: ScoutResult,
  store: ScoutCandidateReviewStore = liveStore(),
): Promise<PersistScoutCandidateReviewResult> {
  const found = parseFoundScoutResult(result);
  const input = toStorageCreateInput(found);
  const existing = await sanitizeStorageRead(() =>
    store.findByIdentity(found.candidate.source.type, found.candidate.discoveryId));

  if (existing !== null) {
    return { review: parseStoredReview(existing), created: false };
  }

  try {
    const created = await store.create(input);
    return { review: parseStoredReview(created), created: true };
  } catch (error) {
    if (!isUniqueIdentityError(error)) throw storageInvalid();
  }

  const concurrent = await sanitizeStorageRead(() =>
    store.findByIdentity(found.candidate.source.type, found.candidate.discoveryId));
  if (concurrent === null) {
    throw new ScoutCandidateReviewError("SCOUT_REVIEW_DUPLICATE_IDENTITY");
  }
  return { review: parseStoredReview(concurrent), created: false };
}

/** Reconstructs the frozen Scout boundary result; callers never rebuild it in a browser. */
export function toScoutFoundResult(review: ScoutCandidateReview): ScoutFoundResult {
  const parsed = scoutFoundResultSchema.safeParse({
    outcome: "FOUND",
    candidate: {
      discoveryId: review.discoveryId,
      companyName: review.companyName,
      ...(review.city === undefined ? {} : { city: review.city }),
      ...(review.region === undefined ? {} : { region: review.region }),
      ...(review.segment === undefined ? {} : { segment: review.segment }),
      ...(review.websiteUrl === undefined ? {} : { websiteUrl: review.websiteUrl }),
      source: review.source,
    },
    basis: review.basis,
    unresolvedQuestions: review.unresolvedQuestions,
  });
  if (!parsed.success) throw storageInvalid();
  return parsed.data;
}

async function requireReview(
  id: string,
  store: ScoutCandidateReviewStore,
): Promise<ScoutCandidateReview> {
  const record = await sanitizeStorageRead(() => store.findById(id));
  if (record === null) throw new ScoutCandidateReviewError("SCOUT_REVIEW_NOT_FOUND");
  return parseStoredReview(record);
}

export async function listPendingScoutCandidateReviews(
  store: ScoutCandidateReviewStore = liveStore(),
): Promise<ScoutCandidateReview[]> {
  const records = await sanitizeStorageRead(() => store.listPending());
  return records.map(parseStoredReview);
}

/** Lists the human-actionable queue, including claims awaiting safe reconciliation. */
export async function listActionableScoutCandidateReviews(
  store: ScoutCandidateReviewStore = liveStore(),
): Promise<ScoutCandidateReview[]> {
  const records = await sanitizeStorageRead(() => store.listActionable());
  return records.map(parseStoredReview);
}

export async function getScoutCandidateReview(
  id: string,
  store: ScoutCandidateReviewStore = liveStore(),
): Promise<ScoutCandidateReview> {
  return requireReview(id, store);
}

async function compareAndSetReviewStatus(
  id: string,
  expectedStatus: ScoutCandidateReviewStatus,
  nextState: ScoutCandidateReviewCompareAndSetInput,
  isIdempotentState: (review: ScoutCandidateReview) => boolean,
  store: ScoutCandidateReviewStore,
): Promise<ScoutCandidateReviewTransitionResult> {
  const result = await sanitizeStorageRead(() =>
    store.compareAndSet(id, expectedStatus, nextState));
  if (!Number.isInteger(result.count) || result.count < 0 || result.count > 1) {
    throw storageInvalid();
  }

  if (result.count === 1) {
    return { review: await requireReview(id, store), changed: true };
  }

  const current = await requireReview(id, store);
  if (isIdempotentState(current)) return { review: current, changed: false };
  throw new ScoutCandidateReviewError("SCOUT_REVIEW_INVALID_STATE");
}

/** Atomically reserves a pending review before any future Lead creation work. */
export async function claimScoutCandidateReviewForApproval(
  id: string,
  store: ScoutCandidateReviewStore = liveStore(),
  now: Date = new Date(),
): Promise<ScoutCandidateReviewApprovalClaimResult> {
  const result = await sanitizeStorageRead(() =>
    store.compareAndSet(id, "PENDING", { status: "APPROVING", reviewedAt: now }));
  if (!Number.isInteger(result.count) || result.count < 0 || result.count > 1) {
    throw storageInvalid();
  }

  // The owner already loaded the immutable review facts before this CAS. Avoiding
  // a required post-write read keeps a proven owner from being stranded on a read failure.
  if (result.count === 1) return { changed: true };

  const current = await requireReview(id, store);
  if (
    current.status === "APPROVING"
    || (current.status === "CONVERTED" && current.leadId !== undefined)
  ) {
    return { changed: false, review: current };
  }
  throw new ScoutCandidateReviewError("SCOUT_REVIEW_INVALID_STATE");
}

/** Releases only an owner claim whose Lead write was proven not to have started. */
export async function releaseScoutCandidateReviewApprovalClaim(
  id: string,
  store: ScoutCandidateReviewStore = liveStore(),
): Promise<ScoutCandidateReviewTransitionResult> {
  return compareAndSetReviewStatus(
    id,
    "APPROVING",
    { status: "PENDING", reviewedAt: null },
    (review) => review.status === "PENDING",
    store,
  );
}

export async function rejectScoutCandidateReview(
  id: string,
  store: ScoutCandidateReviewStore = liveStore(),
  now: Date = new Date(),
): Promise<ScoutCandidateReviewTransitionResult> {
  return compareAndSetReviewStatus(
    id,
    "PENDING",
    { status: "REJECTED", reviewedAt: now },
    (review) => review.status === "REJECTED",
    store,
  );
}

export async function markScoutCandidateReviewConverted(
  id: string,
  leadId: string,
  store: ScoutCandidateReviewStore = liveStore(),
): Promise<ScoutCandidateReviewTransitionResult> {
  const parsedLeadId = leadIdSchema.safeParse(leadId);
  if (!parsedLeadId.success) throw storageInvalid();

  return compareAndSetReviewStatus(
    id,
    "APPROVING",
    { status: "CONVERTED", leadId: parsedLeadId.data },
    (review) => review.status === "CONVERTED" && review.leadId === parsedLeadId.data,
    store,
  );
}

/** Looks up the exact provenance that the Scout approval boundary writes to Lead.source. */
export async function findLeadByScoutProvenance(
  sourceType: ScoutDiscoverySourceType,
  discoveryId: string,
  store: ScoutCandidateReviewStore = liveStore(),
): Promise<{ id: string } | null> {
  const parsedCandidate = scoutDiscoveryCandidateSchema.safeParse({
    discoveryId,
    companyName: "provenance lookup",
    source: { type: sourceType },
  });
  if (!parsedCandidate.success) throw storageInvalid();

  return sanitizeStorageRead(() =>
    store.findLeadIdBySource(
      `SCOUT:${parsedCandidate.data.source.type}:${parsedCandidate.data.discoveryId}`,
    ));
}

/** Supplies all previously persisted discovery identities to a future orchestration layer. */
export async function listSeenScoutDiscoveryIdentities(
  store: ScoutCandidateReviewStore = liveStore(),
): Promise<Array<{ sourceType: ScoutDiscoverySourceType; discoveryId: string }>> {
  const identities = await sanitizeStorageRead(() => store.listSeenIdentities());
  const parsed = seenIdentitySchema.array().safeParse(identities);
  if (!parsed.success) throw storageInvalid();
  return parsed.data;
}
