export const executionAttemptDigestFormat = "execution-attempt/v1";

export type ExecutionAttemptIdentity = Readonly<{
  executionRequestKey: string;
  attemptNumber: number;
  retryOfExecutionRunId?: string | null;
  executorActorId: string;
  capabilityKey: string;
  contractVariantKey?: string | null;
  authoritySubjectRefId?: string | null;
  authorityInvocationId?: string | null;
}>;

export type CanonicalExecutionAttemptIdentity = Readonly<{
  format: typeof executionAttemptDigestFormat;
  executionRequestKey: string;
  attemptNumber: number;
  retryOfExecutionRunId: string | null;
  executorActorId: string;
  capabilityKey: string;
  contractVariantKey: string;
  authoritySubjectRefId: string | null;
  authorityInvocationId: string | null;
}>;

export class ExecutionAttemptIdentityError extends Error {
  constructor() {
    super("EXECUTION_ATTEMPT_IDENTITY_INVALID");
  }
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!text(value)) throw new ExecutionAttemptIdentityError();
  return value;
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ExecutionAttemptIdentityError();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new ExecutionAttemptIdentityError();
    ancestors.add(value);
    try {
      return `[${value.map((item) => canonicalJson(item, ancestors)).join(",")}]`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value)) throw new ExecutionAttemptIdentityError();
    ancestors.add(value);
    try {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`).join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }
  throw new ExecutionAttemptIdentityError();
}

/**
 * Normalizes only durable semantic identity. It deliberately excludes the
 * physical id, attempt key, timestamps, state, outcome, and diagnostics.
 */
export function canonicalizeExecutionAttemptIdentity(
  input: ExecutionAttemptIdentity,
): CanonicalExecutionAttemptIdentity {
  if (!text(input.executionRequestKey) || !Number.isInteger(input.attemptNumber) || input.attemptNumber < 1
    || !text(input.executorActorId) || !text(input.capabilityKey)) {
    throw new ExecutionAttemptIdentityError();
  }
  const retryOfExecutionRunId = optionalText(input.retryOfExecutionRunId);
  if ((input.attemptNumber === 1 && retryOfExecutionRunId !== null)
    || (input.attemptNumber > 1 && retryOfExecutionRunId === null)) {
    throw new ExecutionAttemptIdentityError();
  }
  return {
    format: executionAttemptDigestFormat,
    executionRequestKey: input.executionRequestKey,
    attemptNumber: input.attemptNumber,
    retryOfExecutionRunId,
    executorActorId: input.executorActorId,
    capabilityKey: input.capabilityKey,
    contractVariantKey: optionalText(input.contractVariantKey) ?? "DEFAULT",
    authoritySubjectRefId: optionalText(input.authoritySubjectRefId),
    authorityInvocationId: optionalText(input.authorityInvocationId),
  };
}

export function canonicalExecutionAttemptIdentityJson(input: ExecutionAttemptIdentity): string {
  return canonicalJson(canonicalizeExecutionAttemptIdentity(input));
}

export async function computeCanonicalExecutionAttemptSha256(
  input: ExecutionAttemptIdentity,
): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("EXECUTION_ATTEMPT_HASH_UNAVAILABLE");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalExecutionAttemptIdentityJson(input)),
  );
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}
