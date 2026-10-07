CREATE TABLE "MigrationUnit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "logicalKeySha256" TEXT NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "targetResponsibility" TEXT NOT NULL,
  "ruleVersion" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('PENDING', 'APPLIED', 'SKIPPED', 'AMBIGUOUS', 'FAILED', 'RECONCILE_REQUIRED')),
  "lastFingerprint" TEXT NOT NULL,
  "fingerprintFormat" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MigrationUnit_logicalKeySha256_key" UNIQUE ("logicalKeySha256"),
  CONSTRAINT "MigrationUnit_source_identity_key" UNIQUE ("sourceSystem", "sourceType", "sourceId", "targetResponsibility", "ruleVersion"),
  CHECK (length("sourceSystem") > 0 AND instr("sourceSystem", char(0)) = 0),
  CHECK (length("sourceType") > 0 AND instr("sourceType", char(0)) = 0),
  CHECK (length("sourceId") > 0 AND instr("sourceId", char(0)) = 0),
  CHECK (length("targetResponsibility") > 0 AND instr("targetResponsibility", char(0)) = 0),
  CHECK (length("ruleVersion") > 0 AND instr("ruleVersion", char(0)) = 0),
  CHECK (length("logicalKeySha256") = 64 AND "logicalKeySha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("lastFingerprint") = 64 AND "lastFingerprint" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("fingerprintFormat") > 0 AND instr("fingerprintFormat", char(0)) = 0)
);

CREATE INDEX "MigrationUnit_sourceType_sourceId_idx" ON "MigrationUnit"("sourceType", "sourceId");
CREATE INDEX "MigrationUnit_state_updatedAt_idx" ON "MigrationUnit"("state", "updatedAt");

CREATE TABLE "MigrationAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "migrationUnitId" TEXT NOT NULL,
  "state" TEXT NOT NULL CHECK ("state" IN ('PENDING', 'APPLIED', 'SKIPPED', 'AMBIGUOUS', 'FAILED', 'RECONCILE_REQUIRED')),
  "sourceFingerprint" TEXT NOT NULL,
  "fingerprintFormat" TEXT NOT NULL,
  "sourceProvenanceJson" TEXT NOT NULL,
  "reasonCode" TEXT,
  "outcomeEvidenceJson" TEXT,
  "failureEvidenceJson" TEXT,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME,
  CONSTRAINT "MigrationAttempt_migrationUnitId_fkey" FOREIGN KEY ("migrationUnitId") REFERENCES "MigrationUnit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MigrationAttempt_id_migrationUnitId_key" UNIQUE ("id", "migrationUnitId"),
  CHECK (length("sourceFingerprint") = 64 AND "sourceFingerprint" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("fingerprintFormat") > 0 AND instr("fingerprintFormat", char(0)) = 0),
  CHECK (length("sourceProvenanceJson") <= 32768 AND json_valid("sourceProvenanceJson")),
  CHECK ("outcomeEvidenceJson" IS NULL OR (length("outcomeEvidenceJson") <= 32768 AND json_valid("outcomeEvidenceJson"))),
  CHECK ("failureEvidenceJson" IS NULL OR (length("failureEvidenceJson") <= 32768 AND json_valid("failureEvidenceJson"))),
  CHECK (
    ("state" = 'PENDING' AND "completedAt" IS NULL AND "reasonCode" IS NULL AND "outcomeEvidenceJson" IS NULL AND "failureEvidenceJson" IS NULL)
    OR
    ("state" IN ('APPLIED', 'SKIPPED', 'AMBIGUOUS', 'FAILED', 'RECONCILE_REQUIRED') AND "completedAt" IS NOT NULL)
  )
);

CREATE INDEX "MigrationAttempt_migrationUnitId_startedAt_idx" ON "MigrationAttempt"("migrationUnitId", "startedAt");
CREATE INDEX "MigrationAttempt_state_startedAt_idx" ON "MigrationAttempt"("state", "startedAt");
CREATE UNIQUE INDEX "MigrationAttempt_one_pending_per_unit" ON "MigrationAttempt"("migrationUnitId") WHERE "state" = 'PENDING';

CREATE TABLE "MigrationTargetRef" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "migrationUnitId" TEXT NOT NULL,
  "establishedByAttemptId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetKeyFormat" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "consequenceKind" TEXT NOT NULL CHECK ("consequenceKind" IN ('CREATED', 'ASSOCIATED', 'VERIFIED_PREEXISTING')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MigrationTargetRef_migrationUnitId_fkey" FOREIGN KEY ("migrationUnitId") REFERENCES "MigrationUnit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MigrationTargetRef_establishedByAttemptId_migrationUnitId_fkey" FOREIGN KEY ("establishedByAttemptId", "migrationUnitId") REFERENCES "MigrationAttempt"("id", "migrationUnitId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MigrationTargetRef_unit_target_consequence_key" UNIQUE ("migrationUnitId", "targetType", "targetKey", "consequenceKind"),
  CHECK (length("targetType") > 0 AND instr("targetType", char(0)) = 0),
  CHECK ("targetKeyFormat" IN ('uuid/v1', 'canonical-json/v1')),
  CHECK (
    ("targetKeyFormat" = 'uuid/v1'
      AND length("targetKey") = 36
      AND "targetKey" = lower("targetKey")
      AND "targetKey" NOT GLOB '*[^0-9a-f-]*'
      AND substr("targetKey", 9, 1) = '-'
      AND substr("targetKey", 14, 1) = '-'
      AND substr("targetKey", 19, 1) = '-'
      AND substr("targetKey", 24, 1) = '-')
    OR
    ("targetKeyFormat" = 'canonical-json/v1' AND json_valid("targetKey") AND json_type("targetKey") = 'array')
  )
);

CREATE INDEX "MigrationTargetRef_targetType_targetKey_idx" ON "MigrationTargetRef"("targetType", "targetKey");
CREATE INDEX "MigrationTargetRef_establishedByAttemptId_idx" ON "MigrationTargetRef"("establishedByAttemptId");

CREATE TRIGGER "MigrationUnit_identity_immutable"
BEFORE UPDATE OF "id", "logicalKeySha256", "sourceSystem", "sourceType", "sourceId", "targetResponsibility", "ruleVersion", "createdAt" ON "MigrationUnit"
FOR EACH ROW
WHEN NEW."id" IS NOT OLD."id"
  OR NEW."logicalKeySha256" IS NOT OLD."logicalKeySha256"
  OR NEW."sourceSystem" IS NOT OLD."sourceSystem"
  OR NEW."sourceType" IS NOT OLD."sourceType"
  OR NEW."sourceId" IS NOT OLD."sourceId"
  OR NEW."targetResponsibility" IS NOT OLD."targetResponsibility"
  OR NEW."ruleVersion" IS NOT OLD."ruleVersion"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_UNIT_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER "MigrationUnit_delete_forbidden"
BEFORE DELETE ON "MigrationUnit"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_UNIT_DELETE_FORBIDDEN');
END;

CREATE TRIGGER "MigrationAttempt_insert_pending_only"
BEFORE INSERT ON "MigrationAttempt"
FOR EACH ROW
WHEN NEW."state" <> 'PENDING'
  OR NEW."completedAt" IS NOT NULL
  OR NEW."reasonCode" IS NOT NULL
  OR NEW."outcomeEvidenceJson" IS NOT NULL
  OR NEW."failureEvidenceJson" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_ATTEMPT_MUST_START_PENDING');
END;

CREATE TRIGGER "MigrationAttempt_delete_forbidden"
BEFORE DELETE ON "MigrationAttempt"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_ATTEMPT_DELETE_FORBIDDEN');
END;

CREATE TRIGGER "MigrationAttempt_transition_guard"
BEFORE UPDATE ON "MigrationAttempt"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_ATTEMPT_TERMINAL_IMMUTABLE')
  WHERE OLD."state" <> 'PENDING';

  SELECT RAISE(ABORT, 'MIGRATION_ATTEMPT_CREATION_FIELDS_IMMUTABLE')
  WHERE NEW."id" IS NOT OLD."id"
    OR NEW."migrationUnitId" IS NOT OLD."migrationUnitId"
    OR NEW."sourceFingerprint" IS NOT OLD."sourceFingerprint"
    OR NEW."fingerprintFormat" IS NOT OLD."fingerprintFormat"
    OR NEW."sourceProvenanceJson" IS NOT OLD."sourceProvenanceJson"
    OR NEW."startedAt" IS NOT OLD."startedAt";

  SELECT RAISE(ABORT, 'MIGRATION_ATTEMPT_MUST_TERMINALIZE')
  WHERE NEW."state" NOT IN ('APPLIED', 'SKIPPED', 'AMBIGUOUS', 'FAILED', 'RECONCILE_REQUIRED')
    OR NEW."completedAt" IS NULL;

  SELECT RAISE(ABORT, 'MIGRATION_ATTEMPT_ESTABLISHED_REF_REQUIRES_APPLIED')
  WHERE NEW."state" <> 'APPLIED'
    AND EXISTS (
      SELECT 1 FROM "MigrationTargetRef"
      WHERE "establishedByAttemptId" = OLD."id"
        AND "migrationUnitId" = OLD."migrationUnitId"
    );

  SELECT RAISE(ABORT, 'MIGRATION_ATTEMPT_APPLIED_REQUIRES_TARGET_REF')
  WHERE NEW."state" = 'APPLIED'
    AND NOT EXISTS (
      SELECT 1 FROM "MigrationTargetRef"
      WHERE "migrationUnitId" = OLD."migrationUnitId"
    );
END;

CREATE TRIGGER "MigrationAttempt_pending_projection"
AFTER INSERT ON "MigrationAttempt"
FOR EACH ROW
BEGIN
  UPDATE "MigrationUnit"
  SET "state" = 'PENDING',
      "lastFingerprint" = NEW."sourceFingerprint",
      "fingerprintFormat" = NEW."fingerprintFormat",
      "updatedAt" = NEW."startedAt"
  WHERE "id" = NEW."migrationUnitId";
END;

CREATE TRIGGER "MigrationAttempt_terminal_projection"
AFTER UPDATE ON "MigrationAttempt"
FOR EACH ROW
WHEN OLD."state" = 'PENDING'
  AND NEW."state" IN ('APPLIED', 'SKIPPED', 'AMBIGUOUS', 'FAILED', 'RECONCILE_REQUIRED')
BEGIN
  UPDATE "MigrationUnit"
  SET "state" = NEW."state",
      "lastFingerprint" = NEW."sourceFingerprint",
      "fingerprintFormat" = NEW."fingerprintFormat",
      "updatedAt" = NEW."completedAt"
  WHERE "id" = NEW."migrationUnitId";
END;

CREATE TRIGGER "MigrationTargetRef_insert_pending_attempt_only"
BEFORE INSERT ON "MigrationTargetRef"
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM "MigrationAttempt"
  WHERE "id" = NEW."establishedByAttemptId"
    AND "migrationUnitId" = NEW."migrationUnitId"
    AND "state" = 'PENDING'
)
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_TARGET_REF_REQUIRES_PENDING_ESTABLISHING_ATTEMPT');
END;

CREATE TRIGGER "MigrationTargetRef_update_forbidden"
BEFORE UPDATE ON "MigrationTargetRef"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_TARGET_REF_IMMUTABLE');
END;

CREATE TRIGGER "MigrationTargetRef_delete_forbidden"
BEFORE DELETE ON "MigrationTargetRef"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'MIGRATION_TARGET_REF_DELETE_FORBIDDEN');
END;
