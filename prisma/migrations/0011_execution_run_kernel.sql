-- TR-04B: durable technical-attempt carrier only. This migration deliberately
-- does not create a workflow event, cost record, runtime writer, or endpoint.

CREATE TABLE "ExecutionRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "attemptKey" TEXT NOT NULL UNIQUE,
  "canonicalAttemptSha256" TEXT NOT NULL,
  "executionRequestKey" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "retryOfExecutionRunId" TEXT,
  "executorActorId" TEXT NOT NULL,
  "authorityInvocationId" TEXT,
  "authoritySubjectRefId" TEXT,
  "capabilityKey" TEXT NOT NULL,
  "contractVariantKey" TEXT,
  "correlationKey" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('STARTED', 'SUCCESS', 'FAILED')),
  "startedAt" DATETIME NOT NULL,
  "finishedAt" DATETIME,
  "failureCode" TEXT,
  "diagnosticSummary" TEXT,
  "diagnosticSha256" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionRun_retryOfExecutionRunId_fkey"
    FOREIGN KEY ("retryOfExecutionRunId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExecutionRun_executorActorId_fkey"
    FOREIGN KEY ("executorActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExecutionRun_authorityInvocationId_fkey"
    FOREIGN KEY ("authorityInvocationId") REFERENCES "AuthorityInvocation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExecutionRun_authoritySubjectRefId_fkey"
    FOREIGN KEY ("authoritySubjectRefId") REFERENCES "AuthoritySubjectRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExecutionRun_executionRequestKey_attemptNumber_key" UNIQUE ("executionRequestKey", "attemptNumber"),
  CHECK (length("id") > 0 AND length("id") <= 128 AND instr("id", char(0)) = 0),
  CHECK (length("attemptKey") > 0 AND length("attemptKey") <= 512 AND instr("attemptKey", char(0)) = 0),
  CHECK (length("executionRequestKey") > 0 AND length("executionRequestKey") <= 512 AND instr("executionRequestKey", char(0)) = 0),
  CHECK (length("executorActorId") > 0 AND instr("executorActorId", char(0)) = 0),
  CHECK (length("capabilityKey") > 0 AND length("capabilityKey") <= 256 AND instr("capabilityKey", char(0)) = 0),
  CHECK ("contractVariantKey" IS NULL OR (length("contractVariantKey") > 0 AND length("contractVariantKey") <= 256 AND instr("contractVariantKey", char(0)) = 0)),
  CHECK ("correlationKey" IS NULL OR (length("correlationKey") > 0 AND length("correlationKey") <= 512 AND instr("correlationKey", char(0)) = 0)),
  CHECK (typeof("attemptNumber") = 'integer' AND "attemptNumber" >= 1),
  CHECK (("attemptNumber" = 1 AND "retryOfExecutionRunId" IS NULL) OR ("attemptNumber" > 1 AND "retryOfExecutionRunId" IS NOT NULL)),
  CHECK (length("canonicalAttemptSha256") = 64 AND "canonicalAttemptSha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("diagnosticSha256" IS NULL OR (length("diagnosticSha256") = 64 AND "diagnosticSha256" NOT GLOB '*[^0-9a-f]*')),
  CHECK ("diagnosticSummary" IS NULL OR (length("diagnosticSummary") <= 2048 AND instr("diagnosticSummary", char(0)) = 0)),
  CHECK (("diagnosticSummary" IS NULL AND "diagnosticSha256" IS NULL) OR ("diagnosticSummary" IS NOT NULL AND "diagnosticSha256" IS NOT NULL)),
  CHECK ("failureCode" IS NULL OR (length("failureCode") > 0 AND length("failureCode") <= 128 AND "failureCode" NOT GLOB '*[^A-Z0-9_]*')),
  CHECK (julianday("startedAt") IS NOT NULL),
  CHECK (julianday("createdAt") IS NOT NULL),
  CHECK (
    ("status" = 'STARTED' AND "finishedAt" IS NULL AND "failureCode" IS NULL AND "diagnosticSummary" IS NULL AND "diagnosticSha256" IS NULL)
    OR
    ("status" = 'SUCCESS' AND "finishedAt" IS NOT NULL AND julianday("finishedAt") IS NOT NULL AND julianday("finishedAt") >= julianday("startedAt") AND "failureCode" IS NULL)
    OR
    ("status" = 'FAILED' AND "finishedAt" IS NOT NULL AND julianday("finishedAt") IS NOT NULL AND julianday("finishedAt") >= julianday("startedAt") AND "failureCode" IS NOT NULL)
  )
);

CREATE INDEX "ExecutionRun_executionRequestKey_idx" ON "ExecutionRun"("executionRequestKey");
CREATE INDEX "ExecutionRun_status_startedAt_idx" ON "ExecutionRun"("status", "startedAt");
CREATE INDEX "ExecutionRun_executorActorId_startedAt_idx" ON "ExecutionRun"("executorActorId", "startedAt");
CREATE INDEX "ExecutionRun_authorityInvocationId_idx" ON "ExecutionRun"("authorityInvocationId");

CREATE TRIGGER "ExecutionRun_retry_chain_guard"
BEFORE INSERT ON "ExecutionRun"
FOR EACH ROW
WHEN NEW."retryOfExecutionRunId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'EXECUTION_RUN_RETRY_SELF_REFERENCE')
  WHERE NEW."retryOfExecutionRunId" = NEW."id";

  SELECT RAISE(ABORT, 'EXECUTION_RUN_RETRY_PARENT_MISMATCH')
  WHERE NOT EXISTS (
    SELECT 1
    FROM "ExecutionRun" AS "parent"
    WHERE "parent"."id" = NEW."retryOfExecutionRunId"
      AND "parent"."executionRequestKey" = NEW."executionRequestKey"
      AND "parent"."attemptNumber" = NEW."attemptNumber" - 1
      AND "parent"."capabilityKey" = NEW."capabilityKey"
      AND COALESCE("parent"."contractVariantKey", 'DEFAULT') = COALESCE(NEW."contractVariantKey", 'DEFAULT')
      AND "parent"."authoritySubjectRefId" IS NEW."authoritySubjectRefId"
  );
END;

CREATE TRIGGER "ExecutionRun_authority_invocation_guard"
BEFORE INSERT ON "ExecutionRun"
FOR EACH ROW
WHEN NEW."authorityInvocationId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'EXECUTION_RUN_AUTHORITY_INVOCATION_MISMATCH')
  WHERE NOT EXISTS (
    SELECT 1
    FROM "AuthorityInvocation" AS "invocation"
    WHERE "invocation"."id" = NEW."authorityInvocationId"
      AND "invocation"."executorActorId" = NEW."executorActorId"
      AND "invocation"."capabilityKey" = NEW."capabilityKey"
      AND COALESCE("invocation"."contractVariantKey", 'DEFAULT') = COALESCE(NEW."contractVariantKey", 'DEFAULT')
      AND "invocation"."subjectRefId" IS NEW."authoritySubjectRefId"
  );
END;

CREATE TRIGGER "ExecutionRun_update_guard"
BEFORE UPDATE ON "ExecutionRun"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'EXECUTION_RUN_TERMINAL_IMMUTABLE')
  WHERE OLD."status" <> 'STARTED';

  SELECT RAISE(ABORT, 'EXECUTION_RUN_IDENTITY_IMMUTABLE')
  WHERE NEW."id" IS NOT OLD."id"
    OR NEW."attemptKey" IS NOT OLD."attemptKey"
    OR NEW."canonicalAttemptSha256" IS NOT OLD."canonicalAttemptSha256"
    OR NEW."executionRequestKey" IS NOT OLD."executionRequestKey"
    OR NEW."attemptNumber" IS NOT OLD."attemptNumber"
    OR NEW."retryOfExecutionRunId" IS NOT OLD."retryOfExecutionRunId"
    OR NEW."executorActorId" IS NOT OLD."executorActorId"
    OR NEW."authorityInvocationId" IS NOT OLD."authorityInvocationId"
    OR NEW."authoritySubjectRefId" IS NOT OLD."authoritySubjectRefId"
    OR NEW."capabilityKey" IS NOT OLD."capabilityKey"
    OR NEW."contractVariantKey" IS NOT OLD."contractVariantKey"
    OR NEW."correlationKey" IS NOT OLD."correlationKey"
    OR NEW."startedAt" IS NOT OLD."startedAt"
    OR NEW."createdAt" IS NOT OLD."createdAt";

  SELECT RAISE(ABORT, 'EXECUTION_RUN_FINALIZATION_REQUIRED')
  WHERE NEW."status" NOT IN ('SUCCESS', 'FAILED');
END;

CREATE TRIGGER "ExecutionRun_delete_forbidden"
BEFORE DELETE ON "ExecutionRun"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'EXECUTION_RUN_DELETE_FORBIDDEN');
END;
