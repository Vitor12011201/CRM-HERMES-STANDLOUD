-- TR-04 CostEntry restricted storage core. This is schema-only: it creates no
-- writer, workflow event, attribution, reconciliation, or authority record.
-- Integer coefficients and amounts are limited to JavaScript safe integers,
-- although SQLite itself supports wider signed 64-bit INTEGER values.

CREATE TABLE "CostEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "costEntryKey" TEXT NOT NULL UNIQUE,
  "canonicalCostEntrySha256" TEXT NOT NULL,
  "economicOccurrenceKey" TEXT NOT NULL,
  "measurementSliceKey" TEXT NOT NULL UNIQUE,
  "measurementNature" TEXT NOT NULL CHECK ("measurementNature" IN ('ESTIMATED', 'ACTUAL')),
  "resourceKey" TEXT NOT NULL,
  "unitKey" TEXT NOT NULL,
  "quantityKnowledge" TEXT NOT NULL CHECK ("quantityKnowledge" IN ('KNOWN', 'UNKNOWN')),
  "quantityCoefficient" INTEGER,
  "quantityScale" INTEGER,
  "monetaryKnowledge" TEXT NOT NULL CHECK ("monetaryKnowledge" IN ('KNOWN', 'UNKNOWN')),
  "amountMinor" INTEGER,
  "currency" TEXT,
  "currencyScale" INTEGER,
  "measurementSourceKind" TEXT NOT NULL,
  "sourceReference" TEXT,
  "evidenceSha256" TEXT,
  "measurementBasisSha256" TEXT NOT NULL,
  "occurredAt" DATETIME,
  "observedAt" DATETIME,
  "recordedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "experimentId" TEXT,
  "candidateId" TEXT,
  "commercialCaseId" TEXT,
  "executionRunId" TEXT,
  CONSTRAINT "CostEntry_experimentId_fkey"
    FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CostEntry_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CostEntry_commercialCaseId_fkey"
    FOREIGN KEY ("commercialCaseId") REFERENCES "CommercialCase"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CostEntry_executionRunId_fkey"
    FOREIGN KEY ("executionRunId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (length("id") > 0 AND length("id") <= 128 AND instr("id", char(0)) = 0),
  CHECK (length("costEntryKey") > 0 AND length("costEntryKey") <= 512 AND instr("costEntryKey", char(0)) = 0),
  CHECK (length("economicOccurrenceKey") > 0 AND length("economicOccurrenceKey") <= 512 AND instr("economicOccurrenceKey", char(0)) = 0),
  CHECK (length("measurementSliceKey") > 0 AND length("measurementSliceKey") <= 512 AND instr("measurementSliceKey", char(0)) = 0),
  CHECK (length("canonicalCostEntrySha256") = 64 AND "canonicalCostEntrySha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("resourceKey") > 0 AND length("resourceKey") <= 256 AND instr("resourceKey", char(0)) = 0),
  CHECK (length("unitKey") > 0 AND length("unitKey") <= 256 AND instr("unitKey", char(0)) = 0),
  CHECK (
    ("quantityKnowledge" = 'KNOWN'
      AND typeof("quantityCoefficient") = 'integer'
      AND "quantityCoefficient" >= 0 AND "quantityCoefficient" <= 9007199254740991
      AND typeof("quantityScale") = 'integer'
      AND "quantityScale" >= 0 AND "quantityScale" <= 18)
    OR
    ("quantityKnowledge" = 'UNKNOWN' AND "quantityCoefficient" IS NULL AND "quantityScale" IS NULL)
  ),
  CHECK (
    ("monetaryKnowledge" = 'KNOWN'
      AND typeof("amountMinor") = 'integer'
      AND "amountMinor" >= 0 AND "amountMinor" <= 9007199254740991
      AND "currency" IS NOT NULL AND length("currency") = 3 AND "currency" NOT GLOB '*[^A-Z]*'
      AND typeof("currencyScale") = 'integer'
      AND "currencyScale" >= 0 AND "currencyScale" <= 18)
    OR
    ("monetaryKnowledge" = 'UNKNOWN' AND "amountMinor" IS NULL AND "currency" IS NULL AND "currencyScale" IS NULL)
  ),
  CHECK (length("measurementSourceKind") > 0 AND length("measurementSourceKind") <= 128 AND instr("measurementSourceKind", char(0)) = 0),
  CHECK (
    "sourceReference" IS NULL OR (
      length("sourceReference") = 42
      AND substr("sourceReference", 1, 6) = 'sr:v1:'
      AND instr("sourceReference", char(0)) = 0
      AND substr("sourceReference", 7, 8) NOT GLOB '*[^0-9a-f]*'
      AND substr("sourceReference", 15, 1) = '-'
      AND substr("sourceReference", 16, 4) NOT GLOB '*[^0-9a-f]*'
      AND substr("sourceReference", 20, 1) = '-'
      AND substr("sourceReference", 21, 1) = '4'
      AND substr("sourceReference", 22, 3) NOT GLOB '*[^0-9a-f]*'
      AND substr("sourceReference", 25, 1) = '-'
      AND substr("sourceReference", 26, 1) GLOB '[89ab]'
      AND substr("sourceReference", 27, 3) NOT GLOB '*[^0-9a-f]*'
      AND substr("sourceReference", 30, 1) = '-'
      AND substr("sourceReference", 31, 12) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  CHECK ("evidenceSha256" IS NULL OR (length("evidenceSha256") = 64 AND "evidenceSha256" NOT GLOB '*[^0-9a-f]*')),
  CHECK ("sourceReference" IS NOT NULL OR "evidenceSha256" IS NOT NULL),
  CHECK (length("measurementBasisSha256") = 64 AND "measurementBasisSha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("occurredAt" IS NULL OR julianday("occurredAt") IS NOT NULL),
  CHECK ("observedAt" IS NULL OR julianday("observedAt") IS NOT NULL),
  CHECK (julianday("recordedAt") IS NOT NULL),
  CHECK (julianday("createdAt") IS NOT NULL),
  CHECK ("experimentId" IS NULL OR (length("experimentId") > 0 AND length("experimentId") <= 128 AND instr("experimentId", char(0)) = 0)),
  CHECK ("candidateId" IS NULL OR (length("candidateId") > 0 AND length("candidateId") <= 128 AND instr("candidateId", char(0)) = 0)),
  CHECK ("commercialCaseId" IS NULL OR (length("commercialCaseId") > 0 AND length("commercialCaseId") <= 128 AND instr("commercialCaseId", char(0)) = 0)),
  CHECK ("executionRunId" IS NULL OR (length("executionRunId") > 0 AND length("executionRunId") <= 128 AND instr("executionRunId", char(0)) = 0)),
  CHECK (
    (CASE WHEN "experimentId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "candidateId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "commercialCaseId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "executionRunId" IS NULL THEN 0 ELSE 1 END)
    <= 1
  )
);

CREATE INDEX "CostEntry_economicOccurrenceKey_idx" ON "CostEntry"("economicOccurrenceKey");
CREATE INDEX "CostEntry_experimentId_idx" ON "CostEntry"("experimentId");
CREATE INDEX "CostEntry_candidateId_idx" ON "CostEntry"("candidateId");
CREATE INDEX "CostEntry_commercialCaseId_idx" ON "CostEntry"("commercialCaseId");
CREATE INDEX "CostEntry_executionRunId_idx" ON "CostEntry"("executionRunId");

CREATE TRIGGER "CostEntry_update_forbidden"
BEFORE UPDATE ON "CostEntry"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'COST_ENTRY_IMMUTABLE');
END;

CREATE TRIGGER "CostEntry_delete_forbidden"
BEFORE DELETE ON "CostEntry"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'COST_ENTRY_DELETE_FORBIDDEN');
END;
