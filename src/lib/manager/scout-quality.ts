import {
  assessScoutDuplicate,
  runScoutDeterministicSelection,
  scoutInputSchema,
  scoutResultSchema,
  type ScoutDiscoveryCandidate,
  type ScoutInput,
  type ScoutResult,
} from "@/lib/scout/contracts";

/**
 * SYN-SCOUT-001 is deliberately a pure, synthetic QA proof. This module has
 * no persistence, provider, model, worker, or domain-write dependency.
 * Its digests are deterministic integrity references, not cryptographic
 * security controls.
 */
export const synScout001FixtureVersion = "SYN-SCOUT-001/v1";
export const scoutQualityRubricVersion = "SYN-SCOUT-001-QA/v1";
export const scoutQualityCapability = "SCOUT_DETERMINISTIC_SELECTION";
export const scoutQualitySyntheticLabel = "SYNTHETIC_NO_SIDE_EFFECTS";
export const maxScoutQualityAttempts = 2;

export type ScoutQualityDisposition = "PASS" | "NEEDS_CORRECTION" | "UNCERTAIN" | "BLOCKED";
export type ScoutQualityCapability = typeof scoutQualityCapability;
export type ScoutQualitySyntheticLabel = typeof scoutQualitySyntheticLabel;
export type ScoutQualityFixtureId = "SYN-SCOUT-001/PRIMARY" | "SYN-SCOUT-001/NONE";
export type ScoutQualitySelectionMethod = "SOURCE_ORDER" | "RANKED_OR_SCORED";
export type ScoutQualityDomainEffectClaim = "NONE" | "CREATE_LEAD" | "APPROVE_LEAD" | "EXTERNAL_ACTION";
export type ScoutQualityOperationState = "ACTIVE" | "REVOKED";

export type ScoutQualityViolationCode =
  | "OWNER_REVOKED"
  | "ATTEMPT_LIMIT_EXHAUSTED"
  | "FIXTURE_MANIFEST_INVALID"
  | "CAPABILITY_NOT_ALLOWED"
  | "RUBRIC_VERSION_UNPINNED"
  | "CORRECTION_CONTEXT_INVALID"
  | "CORRECTION_PREDECESSOR_CONTEXT_MISMATCH"
  | "CORRECTION_PREDECESSOR_NOT_REWORK"
  | "CORRECTION_PREDECESSOR_DIGEST_MISMATCH"
  | "DOMAIN_EFFECT_CLAIMED"
  | "SUBMISSION_RESULT_INVALID"
  | "SUBMISSION_RESULT_DIGEST_INVALID"
  | "UNMATCHED_SUBMITTED_CANDIDATE"
  | "CANDIDATE_FIXTURE_CONTENT_MISMATCH"
  | "DUPLICATE_CANDIDATE_SELECTED"
  | "SOURCE_ORDER_OR_SCORE_VIOLATION"
  | "CANONICAL_RESULT_MISMATCH";

export type ScoutQualityCheckRule =
  | "OWNER_OPERATION_ACTIVE"
  | "ATTEMPT_BOUND"
  | "FIXTURE_INTEGRITY"
  | "CAPABILITY_ALLOWLIST"
  | "RUBRIC_VERSION"
  | "CORRECTION_CONTEXT"
  | "CORRECTION_PREDECESSOR_REPLAY"
  | "NO_DOMAIN_EFFECT"
  | "SUBMISSION_SCHEMA"
  | "SUBMISSION_DIGEST"
  | "SUBMITTED_CANDIDATE_REFERENCE"
  | "SUBMITTED_CANDIDATE_CONTENT_AFFINITY"
  | "EXACT_DUPLICATE_EXCLUSION"
  | "SOURCE_ORDER_WITHOUT_SCORE"
  | "CANONICAL_DETERMINISTIC_RESULT"
  | "INDEPENDENT_CHECKER";

export type ScoutQualityFixtureManifest = Readonly<{
  fixtureId: ScoutQualityFixtureId;
  fixtureVersion: typeof synScout001FixtureVersion;
  expectedCapability: ScoutQualityCapability;
  syntheticLabel: ScoutQualitySyntheticLabel;
  scoutInput: ScoutInput;
  inputDigest: string;
  expectedResult: ScoutResult;
  expectedResultDigest: string;
  manifestDigest: string;
}>;

export type ScoutQualitySubmission = Readonly<{
  submittedResult: unknown;
  submittedResultDigest?: string;
  declaredSelectionMethod?: ScoutQualitySelectionMethod;
  declaredDomainEffect?: ScoutQualityDomainEffectClaim;
  /** Informational only; canonical fixture evaluation never trusts this claim. */
  managerClaimedDisposition?: ScoutQualityDisposition;
}>;

export type ScoutQualityCorrectionContext = Readonly<{
  previousAttempt: ScoutQualityFirstAttempt;
  previousReviewDigest: string;
}>;

/** A replayable synthetic input, never an authenticated historical record. */
export type ScoutQualityFirstAttempt = Readonly<{
  fixture: ScoutQualityFixtureManifest;
  expectedCapability: ScoutQualityCapability | string;
  submitted: ScoutQualitySubmission;
  attemptNumber: 1;
  rubricVersion: string;
  ownerOperationState: ScoutQualityOperationState;
}>;

export type ScoutQualityRequest = Readonly<{
  fixture: ScoutQualityFixtureManifest;
  expectedCapability: ScoutQualityCapability | string;
  submitted: ScoutQualitySubmission;
  attemptNumber: number;
  correctionContext?: ScoutQualityCorrectionContext;
  rubricVersion: string;
  ownerOperationState: ScoutQualityOperationState;
}>;

export type ScoutQualityCheck = Readonly<{
  rule: ScoutQualityCheckRule;
  passed: boolean;
  evidenceRef: string;
  evidenceDigest: string;
}>;

export type ScoutQualityFeedback = Readonly<{
  code: ScoutQualityViolationCode;
  instruction: string;
}>;

export type ScoutQualityPredecessorEvidence = Readonly<{
  attemptNumber: 1;
  disposition: "NEEDS_CORRECTION";
  fixtureDigest: string;
  reviewDigest: string;
}>;

export type ScoutQualityCandidateEvidence = Readonly<{
  submittedCandidateDigest: string;
  fixtureCandidateDigest: string | null;
}>;

export type ScoutQualityReview = Readonly<{
  disposition: ScoutQualityDisposition;
  checks: readonly ScoutQualityCheck[];
  violationCodes: readonly ScoutQualityViolationCode[];
  feedback: readonly ScoutQualityFeedback[];
  evidence: Readonly<{
    fixtureId: string;
    fixtureVersion: string;
    fixtureDigest: string;
    expectedResultDigest: string;
    submittedResultDigest: string | null;
    predecessor: ScoutQualityPredecessorEvidence | null;
    candidate: ScoutQualityCandidateEvidence | null;
    syntheticLabel: ScoutQualitySyntheticLabel;
  }>;
  attemptNumber: number;
  correctionsRemaining: number;
  independentChecker: true;
  reviewDigest: string;
}>;

type FixtureResolution =
  | Readonly<{ valid: true; fixture: ScoutQualityFixtureManifest }>
  | Readonly<{ valid: false }>;

const feedbackByViolation: Readonly<Record<ScoutQualityViolationCode, string>> = {
  OWNER_REVOKED: "Stop work: the owner revoked this synthetic operation.",
  ATTEMPT_LIMIT_EXHAUSTED: "Stop work: the one-correction, two-attempt limit is exhausted.",
  FIXTURE_MANIFEST_INVALID: "Provide the unchanged pinned synthetic fixture and its matching deterministic digests.",
  CAPABILITY_NOT_ALLOWED: "Use only the pinned deterministic Scout selection capability.",
  RUBRIC_VERSION_UNPINNED: "Pin the supported SYN-SCOUT-001 QA rubric version before review.",
  CORRECTION_CONTEXT_INVALID: "Second attempts require a prior NEEDS_CORRECTION review reference.",
  CORRECTION_PREDECESSOR_CONTEXT_MISMATCH: "Replay the first synthetic attempt with the same fixture, capability, rubric, and attempt-one context.",
  CORRECTION_PREDECESSOR_NOT_REWORK: "The replayed first synthetic attempt must actually produce NEEDS_CORRECTION.",
  CORRECTION_PREDECESSOR_DIGEST_MISMATCH: "Use the exact digest produced by replaying the prior synthetic NEEDS_CORRECTION review.",
  DOMAIN_EFFECT_CLAIMED: "Remove every Lead approval, Lead creation, or external-action claim; this QA proof has no domain effect.",
  SUBMISSION_RESULT_INVALID: "Submit only a strict Scout FOUND or NONE result under the frozen Scout contract.",
  SUBMISSION_RESULT_DIGEST_INVALID: "Submit the exact deterministic digest of the strict Scout result.",
  UNMATCHED_SUBMITTED_CANDIDATE: "Use a candidate from the pinned synthetic fixture or submit the lawful canonical NONE result.",
  CANDIDATE_FIXTURE_CONTENT_MISMATCH: "Use the exact fixture candidate payload; a reused discovery ID is not sufficient provenance.",
  DUPLICATE_CANDIDATE_SELECTED: "Remove the exact duplicate candidate and re-run the frozen first-eligible source-order rule.",
  SOURCE_ORDER_OR_SCORE_VIOLATION: "Use original source order only; remove every rank or score claim.",
  CANONICAL_RESULT_MISMATCH: "Correct the submitted Scout result so it exactly matches the pinned deterministic fixture result.",
};

function stableValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return `boolean:${value}`;
  if (typeof value === "number") return `number:${value}`;
  if (Array.isArray(value)) return `array:[${value.map(stableValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `object:{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(",")}}`;
  }
  throw new TypeError("SYN_SCOUT_001_NON_SERIALIZABLE_VALUE");
}

/** Exact equality for parsed synthetic payloads; never replace this with a digest comparison. */
function canonicalValueEquals(left: unknown, right: unknown): boolean {
  return stableValue(left) === stableValue(right);
}

function deterministicDigest(value: unknown): string {
  const text = stableValue(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function createFixture(fixtureId: ScoutQualityFixtureId, scoutInput: ScoutInput): ScoutQualityFixtureManifest {
  const parsedInput = scoutInputSchema.parse(scoutInput);
  const expectedResult = runScoutDeterministicSelection(parsedInput);
  const inputDigest = deterministicDigest(parsedInput);
  const expectedResultDigest = deterministicDigest(expectedResult);
  const manifestDigest = deterministicDigest({
    fixtureId,
    fixtureVersion: synScout001FixtureVersion,
    expectedCapability: scoutQualityCapability,
    syntheticLabel: scoutQualitySyntheticLabel,
    inputDigest,
    expectedResultDigest,
  });

  return deepFreeze({
    fixtureId,
    fixtureVersion: synScout001FixtureVersion,
    expectedCapability: scoutQualityCapability,
    syntheticLabel: scoutQualitySyntheticLabel,
    scoutInput: parsedInput,
    inputDigest,
    expectedResult,
    expectedResultDigest,
    manifestDigest,
  });
}

export const synScout001PrimaryFixture = createFixture("SYN-SCOUT-001/PRIMARY", {
  criteria: {
    targetLocations: ["São Paulo"],
    targetSegments: ["Accounting"],
    requirePublicWebsite: true,
    maxCandidatesToInspect: 3,
  },
  discoveryCandidates: [
    {
      discoveryId: "syn-scout-001-alpha",
      companyName: "Alpha Contábil",
      city: "São Paulo",
      region: "SP",
      segment: "Accounting",
      websiteUrl: "https://ALPHA.example/#synthetic",
      source: { type: "DIRECTORY", url: "https://directory.example/alpha-contabil" },
    },
    {
      discoveryId: "syn-scout-001-beta",
      companyName: "Beta Contábil",
      city: "São Paulo",
      region: "SP",
      segment: "Accounting",
      websiteUrl: "https://beta.example/",
      source: { type: "DIRECTORY", url: "https://directory.example/beta-contabil" },
    },
    {
      discoveryId: "syn-scout-001-gamma",
      companyName: "Gamma Contábil",
      city: "São Paulo",
      region: "SP",
      segment: "Accounting",
      source: { type: "DIRECTORY", url: "https://directory.example/gamma-contabil" },
    },
  ],
  existingLeadReferences: [{
    id: "synthetic-lead-alpha",
    companyName: "Alpha Contábil",
    city: "São Paulo",
    region: "SP",
    websiteUrl: "https://alpha.example/",
  }],
});

export const synScout001NoneFixture = createFixture("SYN-SCOUT-001/NONE", {
  criteria: {
    targetLocations: ["São Paulo"],
    targetSegments: ["Accounting"],
    requirePublicWebsite: true,
    maxCandidatesToInspect: 2,
  },
  discoveryCandidates: [
    synScout001PrimaryFixture.scoutInput.discoveryCandidates[0],
    synScout001PrimaryFixture.scoutInput.discoveryCandidates[2],
  ],
  existingLeadReferences: synScout001PrimaryFixture.scoutInput.existingLeadReferences,
});

const canonicalFixtures: Readonly<Record<ScoutQualityFixtureId, ScoutQualityFixtureManifest>> = {
  "SYN-SCOUT-001/PRIMARY": synScout001PrimaryFixture,
  "SYN-SCOUT-001/NONE": synScout001NoneFixture,
};

export function digestScoutQualityResult(result: ScoutResult): string {
  return deterministicDigest(scoutResultSchema.parse(result));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFixtureId(value: unknown): value is ScoutQualityFixtureId {
  return value === "SYN-SCOUT-001/PRIMARY" || value === "SYN-SCOUT-001/NONE";
}

function resolveFixture(value: unknown): FixtureResolution {
  if (!isRecord(value) || !isFixtureId(value.fixtureId)) return { valid: false };
  const canonical = canonicalFixtures[value.fixtureId];
  const parsedInput = scoutInputSchema.safeParse(value.scoutInput);
  const parsedResult = scoutResultSchema.safeParse(value.expectedResult);
  if (!parsedInput.success || !parsedResult.success) return { valid: false };

  const actualResult = runScoutDeterministicSelection(parsedInput.data);
  const inputDigest = deterministicDigest(parsedInput.data);
  const expectedResultDigest = deterministicDigest(parsedResult.data);
  const manifestDigest = deterministicDigest({
    fixtureId: value.fixtureId,
    fixtureVersion: value.fixtureVersion,
    expectedCapability: value.expectedCapability,
    syntheticLabel: value.syntheticLabel,
    inputDigest,
    expectedResultDigest,
  });

  // FNV-1a32 fields below are evidence labels and consistency checks only.
  // Canonical payload equality is the authority for fixture identity.
  const matchesCanonical = value.fixtureVersion === canonical.fixtureVersion
    && value.expectedCapability === canonical.expectedCapability
    && value.syntheticLabel === canonical.syntheticLabel
    && canonicalValueEquals(parsedInput.data, canonical.scoutInput)
    && canonicalValueEquals(parsedResult.data, canonical.expectedResult)
    && canonicalValueEquals(actualResult, canonical.expectedResult)
    && canonicalValueEquals(parsedResult.data, actualResult)
    && value.inputDigest === inputDigest
    && value.expectedResultDigest === expectedResultDigest
    && value.manifestDigest === manifestDigest;

  return matchesCanonical ? { valid: true, fixture: canonical } : { valid: false };
}

function hasForbiddenRankOrScore(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const forbidden = new Set(["score", "rank", "ranking", "priority", "qualificationScore"]);
  return Object.keys(value).some((key) => forbidden.has(key))
    || Object.values(value).some((nested) => hasForbiddenRankOrScore(nested));
}

function fixtureCandidateById(
  candidate: ScoutDiscoveryCandidate,
  fixture: ScoutQualityFixtureManifest,
): ScoutDiscoveryCandidate | undefined {
  return fixture.scoutInput.discoveryCandidates.find((knownCandidate) => knownCandidate.discoveryId === candidate.discoveryId);
}

function candidateMatchesFixture(
  candidate: ScoutDiscoveryCandidate,
  fixtureCandidate: ScoutDiscoveryCandidate | undefined,
): boolean {
  return fixtureCandidate !== undefined && canonicalValueEquals(candidate, fixtureCandidate);
}

function candidateEvidence(
  candidate: ScoutDiscoveryCandidate,
  fixtureCandidate: ScoutDiscoveryCandidate | undefined,
): ScoutQualityCandidateEvidence {
  return {
    submittedCandidateDigest: deterministicDigest(candidate),
    fixtureCandidateDigest: fixtureCandidate === undefined ? null : deterministicDigest(fixtureCandidate),
  };
}

function candidateIsExactDuplicate(candidate: ScoutDiscoveryCandidate, fixture: ScoutQualityFixtureManifest): boolean {
  return fixture.scoutInput.existingLeadReferences.some((reference) => (
    assessScoutDuplicate(candidate, reference) === "EXACT_DUPLICATE"
  ));
}

function createCheck(rule: ScoutQualityCheckRule, passed: boolean, evidenceRef: string): ScoutQualityCheck {
  return {
    rule,
    passed,
    evidenceRef,
    evidenceDigest: deterministicDigest({ rule, passed, evidenceRef }),
  };
}

function uniqueCodes(codes: readonly ScoutQualityViolationCode[]): ScoutQualityViolationCode[] {
  return [...new Set(codes)];
}

type ReviewBindings = Readonly<{
  predecessor?: ScoutQualityPredecessorEvidence;
  candidate?: ScoutQualityCandidateEvidence;
}>;

type CorrectionReplayResolution =
  | Readonly<{ valid: true; predecessor: ScoutQualityPredecessorEvidence }>
  | Readonly<{ valid: false; code: ScoutQualityViolationCode }>;

function isFirstAttempt(value: unknown): value is ScoutQualityFirstAttempt {
  if (!isRecord(value)) return false;
  return value.attemptNumber === 1
    && isRecord(value.fixture)
    && isRecord(value.submitted)
    && typeof value.expectedCapability === "string"
    && typeof value.rubricVersion === "string"
    && (value.ownerOperationState === "ACTIVE" || value.ownerOperationState === "REVOKED");
}

function replayCorrectionPredecessor(
  request: ScoutQualityRequest,
  fixture: ScoutQualityFixtureManifest,
): CorrectionReplayResolution {
  const context = request.correctionContext as unknown;
  if (!isRecord(context)
    || !isRecord(context.previousAttempt)
    || typeof context.previousReviewDigest !== "string"
    || context.previousReviewDigest.length === 0) {
    return { valid: false, code: "CORRECTION_CONTEXT_INVALID" };
  }
  if (!isFirstAttempt(context.previousAttempt)) {
    return { valid: false, code: "CORRECTION_PREDECESSOR_CONTEXT_MISMATCH" };
  }

  const previousAttempt = context.previousAttempt;
  const previousFixture = resolveFixture(previousAttempt.fixture);
  const sameContext = previousFixture.valid
    && previousFixture.fixture.manifestDigest === fixture.manifestDigest
    && previousAttempt.expectedCapability === request.expectedCapability
    && previousAttempt.rubricVersion === request.rubricVersion
    && previousAttempt.ownerOperationState === request.ownerOperationState;
  if (!sameContext) return { valid: false, code: "CORRECTION_PREDECESSOR_CONTEXT_MISMATCH" };

  const priorReview = evaluateSynScout001Quality({
    fixture: previousAttempt.fixture,
    expectedCapability: previousAttempt.expectedCapability,
    submitted: previousAttempt.submitted,
    attemptNumber: 1,
    rubricVersion: previousAttempt.rubricVersion,
    ownerOperationState: previousAttempt.ownerOperationState,
  });
  if (priorReview.disposition !== "NEEDS_CORRECTION") {
    return { valid: false, code: "CORRECTION_PREDECESSOR_NOT_REWORK" };
  }
  if (priorReview.reviewDigest !== context.previousReviewDigest) {
    return { valid: false, code: "CORRECTION_PREDECESSOR_DIGEST_MISMATCH" };
  }

  return {
    valid: true,
    predecessor: {
      attemptNumber: 1,
      disposition: "NEEDS_CORRECTION",
      fixtureDigest: fixture.manifestDigest,
      reviewDigest: priorReview.reviewDigest,
    },
  };
}

function toReview(
  disposition: ScoutQualityDisposition,
  request: ScoutQualityRequest,
  checks: readonly ScoutQualityCheck[],
  codes: readonly ScoutQualityViolationCode[],
  fixture: ScoutQualityFixtureManifest | null,
  submittedResultDigest: string | null,
  bindings: ReviewBindings = {},
): ScoutQualityReview {
  const violationCodes = uniqueCodes(codes);
  const review: Omit<ScoutQualityReview, "reviewDigest"> = {
    disposition,
    checks,
    violationCodes,
    feedback: violationCodes.map((code) => ({ code, instruction: feedbackByViolation[code] })),
    evidence: {
      fixtureId: fixture?.fixtureId ?? "UNRESOLVED_FIXTURE",
      fixtureVersion: fixture?.fixtureVersion ?? "UNRESOLVED_VERSION",
      fixtureDigest: fixture?.manifestDigest ?? "UNRESOLVED_DIGEST",
      expectedResultDigest: fixture?.expectedResultDigest ?? "UNRESOLVED_RESULT_DIGEST",
      submittedResultDigest,
      predecessor: bindings.predecessor ?? null,
      candidate: bindings.candidate ?? null,
      syntheticLabel: scoutQualitySyntheticLabel,
    },
    attemptNumber: request.attemptNumber,
    correctionsRemaining: Number.isInteger(request.attemptNumber)
      ? Math.min(1, Math.max(0, maxScoutQualityAttempts - request.attemptNumber))
      : 0,
    independentChecker: true as const,
  };
  return { ...review, reviewDigest: deterministicDigest(review) };
}

function block(
  request: ScoutQualityRequest,
  checks: readonly ScoutQualityCheck[],
  code: ScoutQualityViolationCode,
  fixture: ScoutQualityFixtureManifest | null = null,
  submittedResultDigest: string | null = null,
  bindings: ReviewBindings = {},
): ScoutQualityReview {
  return toReview("BLOCKED", request, checks, [code], fixture, submittedResultDigest, bindings);
}

function uncertain(
  request: ScoutQualityRequest,
  checks: readonly ScoutQualityCheck[],
  code: ScoutQualityViolationCode,
  fixture: ScoutQualityFixtureManifest | null = null,
  submittedResultDigest: string | null = null,
  bindings: ReviewBindings = {},
): ScoutQualityReview {
  return toReview("UNCERTAIN", request, checks, [code], fixture, submittedResultDigest, bindings);
}

/**
 * Evaluates a static synthetic Scout submission. A PASS is only a QA result;
 * it cannot approve a candidate, create a Lead, dispatch work, or cause an
 * external effect.
 */
export function evaluateSynScout001Quality(request: ScoutQualityRequest): ScoutQualityReview {
  const checks: ScoutQualityCheck[] = [];

  const operationActive = request.ownerOperationState === "ACTIVE";
  checks.push(createCheck("OWNER_OPERATION_ACTIVE", operationActive, "owner-operation-state"));
  if (!operationActive) return block(request, checks, "OWNER_REVOKED");

  const attemptInBounds = Number.isInteger(request.attemptNumber)
    && request.attemptNumber >= 1
    && request.attemptNumber <= maxScoutQualityAttempts;
  checks.push(createCheck("ATTEMPT_BOUND", attemptInBounds, "one-correction-two-attempt-bound"));
  if (!attemptInBounds) return block(request, checks, "ATTEMPT_LIMIT_EXHAUSTED");

  const resolution = resolveFixture(request.fixture);
  checks.push(createCheck("FIXTURE_INTEGRITY", resolution.valid, "syn-scout-001-canonical-manifest"));
  if (!resolution.valid) return uncertain(request, checks, "FIXTURE_MANIFEST_INVALID");
  const fixture = resolution.fixture;

  const capabilityAllowed = request.expectedCapability === fixture.expectedCapability;
  checks.push(createCheck("CAPABILITY_ALLOWLIST", capabilityAllowed, "scout-deterministic-selection-only"));
  if (!capabilityAllowed) return block(request, checks, "CAPABILITY_NOT_ALLOWED", fixture);

  const rubricPinned = request.rubricVersion === scoutQualityRubricVersion;
  checks.push(createCheck("RUBRIC_VERSION", rubricPinned, "syn-scout-001-qa-rubric"));
  if (!rubricPinned) return uncertain(request, checks, "RUBRIC_VERSION_UNPINNED", fixture);

  let predecessor: ScoutQualityPredecessorEvidence | undefined;
  if (request.attemptNumber === 1) {
    const firstAttemptHasNoPredecessor = request.correctionContext === undefined;
    checks.push(createCheck("CORRECTION_CONTEXT", firstAttemptHasNoPredecessor, "first-attempt-no-predecessor"));
    checks.push(createCheck("CORRECTION_PREDECESSOR_REPLAY", firstAttemptHasNoPredecessor, "first-attempt-no-replay"));
    if (!firstAttemptHasNoPredecessor) return uncertain(request, checks, "CORRECTION_CONTEXT_INVALID", fixture);
  } else {
    const replay = replayCorrectionPredecessor(request, fixture);
    checks.push(createCheck("CORRECTION_CONTEXT", replay.valid, "bounded-correction-context"));
    checks.push(createCheck("CORRECTION_PREDECESSOR_REPLAY", replay.valid, "synthetic-first-attempt-replay"));
    if (!replay.valid) return uncertain(request, checks, replay.code, fixture);
    predecessor = replay.predecessor;
  }

  const noDomainEffect = request.submitted.declaredDomainEffect === "NONE";
  checks.push(createCheck("NO_DOMAIN_EFFECT", noDomainEffect, "synthetic-no-domain-effect"));
  if (!noDomainEffect) return block(request, checks, "DOMAIN_EFFECT_CLAIMED", fixture, null, { predecessor });

  const parsedSubmission = scoutResultSchema.safeParse(request.submitted.submittedResult);
  const manufacturedRankOrScore = hasForbiddenRankOrScore(request.submitted.submittedResult);
  checks.push(createCheck("SUBMISSION_SCHEMA", parsedSubmission.success, "strict-scout-result-schema"));
  if (!parsedSubmission.success) return block(request, checks, "SUBMISSION_RESULT_INVALID", fixture, null, { predecessor });

  const submittedResultDigest = deterministicDigest(parsedSubmission.data);
  const suppliedDigestMatches = request.submitted.submittedResultDigest === submittedResultDigest;
  checks.push(createCheck("SUBMISSION_DIGEST", suppliedDigestMatches, "submitted-result-digest"));
  if (!suppliedDigestMatches) {
    return uncertain(request, checks, "SUBMISSION_RESULT_DIGEST_INVALID", fixture, submittedResultDigest, { predecessor });
  }

  const submittedCandidate = parsedSubmission.data.outcome === "FOUND" ? parsedSubmission.data.candidate : undefined;
  const fixtureCandidate = submittedCandidate === undefined ? undefined : fixtureCandidateById(submittedCandidate, fixture);
  const bindings: ReviewBindings = submittedCandidate === undefined
    ? { predecessor }
    : { predecessor, candidate: candidateEvidence(submittedCandidate, fixtureCandidate) };

  const candidateReferenced = submittedCandidate === undefined || fixtureCandidate !== undefined;
  checks.push(createCheck("SUBMITTED_CANDIDATE_REFERENCE", candidateReferenced, "fixture-candidate-identities"));
  if (!candidateReferenced) {
    return uncertain(request, checks, "UNMATCHED_SUBMITTED_CANDIDATE", fixture, submittedResultDigest, bindings);
  }

  const candidateContentMatches = submittedCandidate === undefined || candidateMatchesFixture(submittedCandidate, fixtureCandidate);
  checks.push(createCheck("SUBMITTED_CANDIDATE_CONTENT_AFFINITY", candidateContentMatches, "fixture-candidate-content-digest"));
  if (!candidateContentMatches) {
    return uncertain(request, checks, "CANDIDATE_FIXTURE_CONTENT_MISMATCH", fixture, submittedResultDigest, bindings);
  }

  const selectedDuplicate = parsedSubmission.data.outcome === "FOUND"
    && candidateIsExactDuplicate(parsedSubmission.data.candidate, fixture);
  checks.push(createCheck("EXACT_DUPLICATE_EXCLUSION", !selectedDuplicate, "scout-exact-duplicate-rule"));

  const sourceOrderOnly = request.submitted.declaredSelectionMethod === "SOURCE_ORDER" && !manufacturedRankOrScore;
  checks.push(createCheck("SOURCE_ORDER_WITHOUT_SCORE", sourceOrderOnly, "scout-original-source-order-no-score"));

  const canonicalResultMatches = canonicalValueEquals(parsedSubmission.data, fixture.expectedResult);
  checks.push(createCheck("CANONICAL_DETERMINISTIC_RESULT", canonicalResultMatches, "scout-canonical-fixture-result"));
  checks.push(createCheck("INDEPENDENT_CHECKER", true, "canonical-fixture-not-manager-claim"));

  const corrections: ScoutQualityViolationCode[] = [];
  if (selectedDuplicate) corrections.push("DUPLICATE_CANDIDATE_SELECTED");
  if (!sourceOrderOnly) corrections.push("SOURCE_ORDER_OR_SCORE_VIOLATION");
  if (!canonicalResultMatches) corrections.push("CANONICAL_RESULT_MISMATCH");

  return toReview(
    corrections.length === 0 ? "PASS" : "NEEDS_CORRECTION",
    request,
    checks,
    corrections,
    fixture,
    submittedResultDigest,
    bindings,
  );
}
