import { describe, expect, it } from "vitest";

import {
  digestScoutQualityResult,
  evaluateSynScout001Quality,
  scoutQualityCapability,
  scoutQualityRubricVersion,
  synScout001NoneFixture,
  synScout001PrimaryFixture,
  type ScoutQualityFirstAttempt,
  type ScoutQualityFixtureManifest,
  type ScoutQualityRequest,
} from "./scout-quality";

function cloneFixture(fixture: ScoutQualityFixtureManifest): ScoutQualityFixtureManifest {
  return JSON.parse(JSON.stringify(fixture)) as ScoutQualityFixtureManifest;
}

function requestFor(
  fixture: ScoutQualityFixtureManifest = synScout001PrimaryFixture,
  overrides: Partial<ScoutQualityRequest> = {},
): ScoutQualityRequest {
  return {
    fixture,
    expectedCapability: scoutQualityCapability,
    submitted: {
      submittedResult: fixture.expectedResult,
      submittedResultDigest: digestScoutQualityResult(fixture.expectedResult),
      declaredSelectionMethod: "SOURCE_ORDER",
      declaredDomainEffect: "NONE",
    },
    attemptNumber: 1,
    rubricVersion: scoutQualityRubricVersion,
    ownerOperationState: "ACTIVE",
    ...overrides,
  };
}

function alphaResult() {
  const alpha = synScout001PrimaryFixture.scoutInput.discoveryCandidates[0];
  return {
    outcome: "FOUND" as const,
    candidate: alpha,
    basis: [
      "Discovery record reports city as São Paulo.",
      "Discovery candidate matches segment Accounting.",
      "A public HTTP(S) website URL was supplied.",
      "Discovery provenance type is DIRECTORY.",
    ],
    unresolvedQuestions: [],
  };
}

function firstRejectedAttempt(): ScoutQualityFirstAttempt {
  const result = alphaResult();
  return {
    fixture: synScout001PrimaryFixture,
    expectedCapability: scoutQualityCapability,
    submitted: {
      submittedResult: result,
      submittedResultDigest: digestScoutQualityResult(result),
      declaredSelectionMethod: "SOURCE_ORDER",
      declaredDomainEffect: "NONE",
    },
    attemptNumber: 1,
    rubricVersion: scoutQualityRubricVersion,
    ownerOperationState: "ACTIVE",
  };
}

function correctedRequest(): ScoutQualityRequest {
  const previousAttempt = firstRejectedAttempt();
  const previousReview = evaluateSynScout001Quality(previousAttempt);
  if (previousReview.disposition !== "NEEDS_CORRECTION") throw new Error("SYN_SCOUT_001_EXPECTED_REWORK");
  return requestFor(synScout001PrimaryFixture, {
    attemptNumber: 2,
    correctionContext: {
      previousAttempt,
      previousReviewDigest: previousReview.reviewDigest,
    },
  });
}

describe("SYN-SCOUT-001 pure quality checker", () => {
  it("T01 marks Alpha as a correctable exact duplicate instead of accepting it", () => {
    const result = alphaResult();
    const review = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        submittedResult: result,
        submittedResultDigest: digestScoutQualityResult(result),
        declaredSelectionMethod: "SOURCE_ORDER",
        declaredDomainEffect: "NONE",
      },
    }));

    expect(review.disposition).toBe("NEEDS_CORRECTION");
    expect(review.violationCodes).toEqual(expect.arrayContaining([
      "DUPLICATE_CANDIDATE_SELECTED",
      "CANONICAL_RESULT_MISMATCH",
    ]));
    expect(review.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "EXACT_DUPLICATE_EXCLUSION", passed: false, evidenceRef: "scout-exact-duplicate-rule" }),
    ]));
  });

  it("T02 accepts the valid Beta correction on the second bounded attempt without domain approval", () => {
    const review = evaluateSynScout001Quality(correctedRequest());
    const predecessor = evaluateSynScout001Quality(firstRejectedAttempt());

    expect(review.disposition).toBe("PASS");
    expect(review.attemptNumber).toBe(2);
    expect(review.correctionsRemaining).toBe(0);
    expect(review.evidence.syntheticLabel).toBe("SYNTHETIC_NO_SIDE_EFFECTS");
    expect(review.evidence.predecessor).toEqual({
      attemptNumber: 1,
      disposition: "NEEDS_CORRECTION",
      fixtureDigest: synScout001PrimaryFixture.manifestDigest,
      reviewDigest: predecessor.reviewDigest,
    });
    expect(review.violationCodes).toEqual([]);
  });

  it("T02-negative fails closed for a forged predecessor review digest", () => {
    const valid = correctedRequest();
    const review = evaluateSynScout001Quality({
      ...valid,
      correctionContext: {
        ...valid.correctionContext!,
        previousReviewDigest: "fnv1a32:forged-prior",
      },
    });

    expect(review).toMatchObject({
      disposition: "UNCERTAIN",
      violationCodes: ["CORRECTION_PREDECESSOR_DIGEST_MISMATCH"],
    });
  });

  it("T02-negative fails closed unless the predecessor is a same-context attempt-one rework", () => {
    const passingAttempt: ScoutQualityFirstAttempt = {
      fixture: synScout001PrimaryFixture,
      expectedCapability: scoutQualityCapability,
      submitted: requestFor().submitted,
      attemptNumber: 1,
      rubricVersion: scoutQualityRubricVersion,
      ownerOperationState: "ACTIVE",
    };
    const passingReview = evaluateSynScout001Quality(passingAttempt);
    const priorPass = evaluateSynScout001Quality(requestFor(undefined, {
      attemptNumber: 2,
      correctionContext: { previousAttempt: passingAttempt, previousReviewDigest: passingReview.reviewDigest },
    }));
    const reworkAttempt = firstRejectedAttempt();
    const reworkReview = evaluateSynScout001Quality(reworkAttempt);
    const contextMismatches = [
      { ...reworkAttempt, fixture: synScout001NoneFixture },
      { ...reworkAttempt, rubricVersion: "SYN-SCOUT-001-QA/other" },
      { ...reworkAttempt, expectedCapability: "OTHER_CAPABILITY" },
      { ...reworkAttempt, attemptNumber: 2 },
    ];

    expect(priorPass).toMatchObject({
      disposition: "UNCERTAIN",
      violationCodes: ["CORRECTION_PREDECESSOR_NOT_REWORK"],
    });
    for (const previousAttempt of contextMismatches) {
      const review = evaluateSynScout001Quality(requestFor(undefined, {
        attemptNumber: 2,
        correctionContext: {
          previousAttempt: previousAttempt as ScoutQualityFirstAttempt,
          previousReviewDigest: reworkReview.reviewDigest,
        },
      }));
      expect(review).toMatchObject({
        disposition: "UNCERTAIN",
        violationCodes: ["CORRECTION_PREDECESSOR_CONTEXT_MISMATCH"],
      });
    }
  });

  it("T03 accepts a lawful Scout NONE result from the alternate frozen synthetic fixture", () => {
    const review = evaluateSynScout001Quality(requestFor(synScout001NoneFixture));

    expect(synScout001NoneFixture.expectedResult).toMatchObject({ outcome: "NONE", reason: "NO_ELIGIBLE_CANDIDATE" });
    expect(review.disposition).toBe("PASS");
  });

  it("T04 fails closed as UNCERTAIN for a missing fixture version", () => {
    const fixture = cloneFixture(synScout001PrimaryFixture) as unknown as Record<string, unknown>;
    delete fixture.fixtureVersion;

    const review = evaluateSynScout001Quality(requestFor(fixture as ScoutQualityFixtureManifest));

    expect(review.disposition).toBe("UNCERTAIN");
    expect(review.violationCodes).toEqual(["FIXTURE_MANIFEST_INVALID"]);
  });

  it("T05 blocks a claimed Lead creation with no side effect", () => {
    const review = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        ...requestFor().submitted,
        declaredDomainEffect: "CREATE_LEAD",
      },
    }));

    expect(review.disposition).toBe("BLOCKED");
    expect(review.violationCodes).toEqual(["DOMAIN_EFFECT_CLAIMED"]);
  });

  it("T06 blocks a third attempt after the one correction limit", () => {
    const review = evaluateSynScout001Quality(requestFor(undefined, {
      attemptNumber: 3,
    }));

    expect(review.disposition).toBe("BLOCKED");
    expect(review.violationCodes).toEqual(["ATTEMPT_LIMIT_EXHAUSTED"]);
    expect(review.correctionsRemaining).toBe(0);
  });

  it("T07 requests correction for an untampered fixture candidate that loses the real eligibility selection", () => {
    const gamma = synScout001PrimaryFixture.scoutInput.discoveryCandidates[2];
    const result = {
      outcome: "FOUND" as const,
      candidate: gamma,
      basis: ["Discovery provenance type is DIRECTORY."],
      unresolvedQuestions: [],
    };
    const review = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        submittedResult: result,
        submittedResultDigest: digestScoutQualityResult(result),
        declaredSelectionMethod: "SOURCE_ORDER",
        declaredDomainEffect: "NONE",
      },
    }));

    expect(review.disposition).toBe("NEEDS_CORRECTION");
    expect(review.violationCodes).toContain("CANONICAL_RESULT_MISMATCH");
  });

  it("T08 fails closed for a forged digest or unmatched candidate identity", () => {
    const forgedDigest = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        ...requestFor().submitted,
        submittedResultDigest: "fnv1a32:forged00",
      },
    }));
    const expected = synScout001PrimaryFixture.expectedResult;
    if (expected.outcome !== "FOUND") throw new Error("SYN_SCOUT_001_EXPECTED_FOUND");
    const unmatchedResult = {
      outcome: "FOUND" as const,
      candidate: {
        ...expected.candidate,
        discoveryId: "synthetic-unmatched",
      },
      basis: expected.basis,
      unresolvedQuestions: expected.unresolvedQuestions,
    };
    const unmatched = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        submittedResult: unmatchedResult,
        submittedResultDigest: digestScoutQualityResult(unmatchedResult),
        declaredSelectionMethod: "SOURCE_ORDER",
        declaredDomainEffect: "NONE",
      },
    }));

    expect(forgedDigest).toMatchObject({ disposition: "UNCERTAIN", violationCodes: ["SUBMISSION_RESULT_DIGEST_INVALID"] });
    expect(unmatched).toMatchObject({ disposition: "UNCERTAIN", violationCodes: ["UNMATCHED_SUBMITTED_CANDIDATE"] });
  });

  it("T08b fails closed when Beta's discovery ID is reused with a changed fixture payload", () => {
    const expected = synScout001PrimaryFixture.expectedResult;
    if (expected.outcome !== "FOUND") throw new Error("SYN_SCOUT_001_EXPECTED_FOUND");
    const changedCandidate = {
      ...expected.candidate,
      source: { type: "WEBSITE" as const, url: "https://changed.example/beta" },
    };
    const result = {
      outcome: "FOUND" as const,
      candidate: changedCandidate,
      basis: expected.basis,
      unresolvedQuestions: expected.unresolvedQuestions,
    };
    const review = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        submittedResult: result,
        submittedResultDigest: digestScoutQualityResult(result),
        declaredSelectionMethod: "SOURCE_ORDER",
        declaredDomainEffect: "NONE",
      },
    }));

    expect(review).toMatchObject({
      disposition: "UNCERTAIN",
      violationCodes: ["CANDIDATE_FIXTURE_CONTENT_MISMATCH"],
    });
    expect(review.evidence.candidate).toEqual(expect.objectContaining({
      submittedCandidateDigest: expect.any(String),
      fixtureCandidateDigest: expect.any(String),
    }));
    expect(review.evidence.candidate?.submittedCandidateDigest).not.toBe(review.evidence.candidate?.fixtureCandidateDigest);
  });

  it("T08c rejects the known FNV32-colliding Beta payload through exact canonical equality", () => {
    const expected = synScout001PrimaryFixture.expectedResult;
    if (expected.outcome !== "FOUND") throw new Error("SYN_SCOUT_001_EXPECTED_FOUND");
    const collidingCandidate = {
      ...expected.candidate,
      websiteUrl: "https://beta.example/RWXdPm",
    };
    const result = {
      outcome: "FOUND" as const,
      candidate: collidingCandidate,
      basis: expected.basis,
      unresolvedQuestions: expected.unresolvedQuestions,
    };
    const review = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        submittedResult: result,
        submittedResultDigest: digestScoutQualityResult(result),
        declaredSelectionMethod: "SOURCE_ORDER",
        declaredDomainEffect: "NONE",
      },
    }));

    expect(review.evidence.candidate?.submittedCandidateDigest).toBe(review.evidence.candidate?.fixtureCandidateDigest);
    expect(collidingCandidate.websiteUrl).not.toBe(expected.candidate.websiteUrl);
    expect(review).toMatchObject({
      disposition: "UNCERTAIN",
      violationCodes: ["CANDIDATE_FIXTURE_CONTENT_MISMATCH"],
    });
    expect(review.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "SUBMITTED_CANDIDATE_CONTENT_AFFINITY", passed: false }),
    ]));
  });

  it("rejects an FNV32-colliding full ScoutResult when its canonical basis differs", () => {
    const expected = synScout001PrimaryFixture.expectedResult;
    if (expected.outcome !== "FOUND") throw new Error("SYN_SCOUT_001_EXPECTED_FOUND");
    const alteredBasis = [...expected.basis];
    alteredBasis[0] = alteredBasis[0].replace("record", "eR9o_o");
    const alteredResult = { ...expected, basis: alteredBasis };
    const alteredDigest = digestScoutQualityResult(alteredResult);
    const canonicalDigest = digestScoutQualityResult(expected);
    const review = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        submittedResult: alteredResult,
        submittedResultDigest: alteredDigest,
        declaredSelectionMethod: "SOURCE_ORDER",
        declaredDomainEffect: "NONE",
      },
    }));

    expect(alteredDigest).toBe(canonicalDigest);
    expect(alteredResult.basis[0]).not.toBe(expected.basis[0]);
    expect(review.disposition).toBe("NEEDS_CORRECTION");
    expect(review.violationCodes).toContain("CANONICAL_RESULT_MISMATCH");
    expect(review.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "CANONICAL_DETERMINISTIC_RESULT", passed: false }),
    ]));
  });

  it("rejects a changed fixture payload even when it retains the pinned FNV label fields", () => {
    const fixture = cloneFixture(synScout001PrimaryFixture);
    const canonicalClaimedInputDigest = fixture.inputDigest;
    fixture.scoutInput.discoveryCandidates[1].websiteUrl = "https://beta.example/RWXdPm";

    const review = evaluateSynScout001Quality(requestFor(fixture));

    expect(fixture.inputDigest).toBe(canonicalClaimedInputDigest);
    expect(review).toMatchObject({
      disposition: "UNCERTAIN",
      violationCodes: ["FIXTURE_MANIFEST_INVALID"],
    });
  });

  it("T09 rejects a source-order/rank claim even when the candidate otherwise matches", () => {
    const review = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        ...requestFor().submitted,
        declaredSelectionMethod: "RANKED_OR_SCORED",
      },
    }));

    expect(review.disposition).toBe("NEEDS_CORRECTION");
    expect(review.violationCodes).toEqual(["SOURCE_ORDER_OR_SCORE_VIOLATION"]);
  });

  it("T10 is deterministic for the same fixture, rubric, and submission", () => {
    const first = evaluateSynScout001Quality(requestFor());
    const second = evaluateSynScout001Quality(requestFor());

    expect(first).toEqual(second);
    expect(first.reviewDigest).toBe(second.reviewDigest);
  });

  it("T11 uses the canonical fixture instead of a contradictory manager PASS claim", () => {
    const result = alphaResult();
    const review = evaluateSynScout001Quality(requestFor(undefined, {
      submitted: {
        submittedResult: result,
        submittedResultDigest: digestScoutQualityResult(result),
        declaredSelectionMethod: "SOURCE_ORDER",
        declaredDomainEffect: "NONE",
        managerClaimedDisposition: "PASS",
      },
    }));

    expect(review.disposition).toBe("NEEDS_CORRECTION");
    expect(review.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "INDEPENDENT_CHECKER", passed: true, evidenceRef: "canonical-fixture-not-manager-claim" }),
    ]));
  });

  it("T12 stops further correction when the owner revokes the synthetic operation", () => {
    const review = evaluateSynScout001Quality(requestFor(undefined, { ownerOperationState: "REVOKED" }));

    expect(review.disposition).toBe("BLOCKED");
    expect(review.violationCodes).toEqual(["OWNER_REVOKED"]);
    expect(review.checks).toEqual([expect.objectContaining({ rule: "OWNER_OPERATION_ACTIVE", passed: false })]);
  });
});
