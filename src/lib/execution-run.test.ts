import { describe, expect, it } from "vitest";

import {
  ExecutionAttemptIdentityError,
  canonicalExecutionAttemptIdentityJson,
  canonicalizeExecutionAttemptIdentity,
  computeCanonicalExecutionAttemptSha256,
  executionAttemptDigestFormat,
} from "./execution-run";

const baseAttempt = {
  executionRequestKey: "request:research:company-1",
  attemptNumber: 1,
  retryOfExecutionRunId: null,
  executorActorId: "actor-system-a",
  capabilityKey: "research.company",
  contractVariantKey: null,
  authoritySubjectRefId: "subject-company-1",
  authorityInvocationId: null,
};

describe("TR-04B ExecutionRun attempt identity", () => {
  it("is deterministic, versioned, and independent from object property order", async () => {
    const reordered = {
      authorityInvocationId: null,
      capabilityKey: "research.company",
      attemptNumber: 1,
      executionRequestKey: "request:research:company-1",
      authoritySubjectRefId: "subject-company-1",
      retryOfExecutionRunId: null,
      contractVariantKey: undefined,
      executorActorId: "actor-system-a",
    };
    const first = await computeCanonicalExecutionAttemptSha256(baseAttempt);
    const second = await computeCanonicalExecutionAttemptSha256(reordered);
    expect(first).toBe(second);
    expect(canonicalizeExecutionAttemptIdentity(baseAttempt)).toMatchObject({
      format: executionAttemptDigestFormat,
      contractVariantKey: "DEFAULT",
    });
    expect(canonicalExecutionAttemptIdentityJson(baseAttempt)).toContain(executionAttemptDigestFormat);
  });

  it("changes when a semantic attempt field changes", async () => {
    const original = await computeCanonicalExecutionAttemptSha256(baseAttempt);
    await expect(computeCanonicalExecutionAttemptSha256({ ...baseAttempt, capabilityKey: "research.changed" }))
      .resolves.not.toBe(original);
    await expect(computeCanonicalExecutionAttemptSha256({
      ...baseAttempt,
      attemptNumber: 2,
      retryOfExecutionRunId: "run-attempt-1",
    })).resolves.not.toBe(original);
    await expect(computeCanonicalExecutionAttemptSha256({ ...baseAttempt, authorityInvocationId: "invocation-1" }))
      .resolves.not.toBe(original);
  });

  it("rejects malformed first attempts and malformed retries", () => {
    expect(() => canonicalizeExecutionAttemptIdentity({ ...baseAttempt, retryOfExecutionRunId: "unexpected" }))
      .toThrow(ExecutionAttemptIdentityError);
    expect(() => canonicalizeExecutionAttemptIdentity({ ...baseAttempt, attemptNumber: 2 }))
      .toThrow("EXECUTION_ATTEMPT_IDENTITY_INVALID");
    expect(() => canonicalizeExecutionAttemptIdentity({ ...baseAttempt, capabilityKey: "" }))
      .toThrow("EXECUTION_ATTEMPT_IDENTITY_INVALID");
  });
});
