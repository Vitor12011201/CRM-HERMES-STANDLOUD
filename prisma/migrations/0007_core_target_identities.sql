CREATE TABLE "Experiment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Business" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Candidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "businessId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK ("status" IN ('DISCOVERED', 'UNCERTAIN', 'RESEARCH', 'DISCARD')),
  "discoveryTrace" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Candidate_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "Candidate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("status" <> 'RESEARCH' OR "businessId" IS NOT NULL)
);

CREATE INDEX "Candidate_experimentId_idx" ON "Candidate"("experimentId");
CREATE INDEX "Candidate_businessId_idx" ON "Candidate"("businessId");

CREATE TABLE "CommercialCase" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "stage" TEXT NOT NULL DEFAULT 'RESEARCH' CHECK ("stage" IN ('RESEARCH', 'DIAGNOSIS', 'OPPORTUNITY', 'DEMO', 'OUTREACH', 'SALES', 'CLOSED')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CommercialCase_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommercialCase_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "CommercialCase_experimentId_idx" ON "CommercialCase"("experimentId");
CREATE INDEX "CommercialCase_businessId_idx" ON "CommercialCase"("businessId");

CREATE TABLE "CommercialCaseOrigin" (
  "commercialCaseId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("commercialCaseId", "candidateId"),
  CONSTRAINT "CommercialCaseOrigin_commercialCaseId_fkey" FOREIGN KEY ("commercialCaseId") REFERENCES "CommercialCase" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CommercialCaseOrigin_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "CommercialCaseOrigin_candidateId_idx" ON "CommercialCaseOrigin"("candidateId");

CREATE TABLE "Contact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Contact_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "Contact_id_businessId_key" UNIQUE ("id", "businessId")
);

CREATE INDEX "Contact_businessId_idx" ON "Contact"("businessId");

CREATE TABLE "ContactPoint" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "contactId" TEXT,
  "contactBusinessId" TEXT,
  "kind" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ContactPoint_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ContactPoint_contactId_contactBusinessId_fkey" FOREIGN KEY ("contactId", "contactBusinessId") REFERENCES "Contact" ("id", "businessId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (
    ("contactId" IS NULL AND "contactBusinessId" IS NULL)
    OR
    (
      "contactId" IS NOT NULL
      AND "contactBusinessId" IS NOT NULL
      AND "contactBusinessId" = "businessId"
    )
  )
);

CREATE INDEX "ContactPoint_businessId_idx" ON "ContactPoint"("businessId");
CREATE INDEX "ContactPoint_contactId_contactBusinessId_idx" ON "ContactPoint"("contactId", "contactBusinessId");

CREATE TABLE "Actor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "category" TEXT NOT NULL CHECK ("category" IN ('HUMAN', 'SYSTEM', 'AI', 'TOOL_ENABLED_AI', 'EXTERNAL_PARTY')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER "CommercialCase_birth_requires_research"
BEFORE INSERT ON "CommercialCase"
FOR EACH ROW
WHEN NEW."stage" <> 'RESEARCH'
BEGIN
  SELECT RAISE(ABORT, 'COMMERCIAL_CASE_BIRTH_STAGE_MUST_BE_RESEARCH');
END;

CREATE TRIGGER "CommercialCaseOrigin_insert_requires_coherent_candidate"
BEFORE INSERT ON "CommercialCaseOrigin"
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM "Candidate" AS "candidate"
  INNER JOIN "CommercialCase" AS "commercialCase"
    ON "commercialCase"."id" = NEW."commercialCaseId"
  WHERE "candidate"."id" = NEW."candidateId"
    AND "candidate"."status" = 'RESEARCH'
    AND "candidate"."businessId" IS NOT NULL
    AND "candidate"."businessId" = "commercialCase"."businessId"
    AND "candidate"."experimentId" = "commercialCase"."experimentId"
)
BEGIN
  SELECT RAISE(ABORT, 'COMMERCIAL_CASE_ORIGIN_COHERENCE_VIOLATION');
END;

CREATE TRIGGER "CommercialCaseOrigin_identity_immutable"
BEFORE UPDATE OF "commercialCaseId", "candidateId" ON "CommercialCaseOrigin"
FOR EACH ROW
WHEN NEW."commercialCaseId" IS NOT OLD."commercialCaseId"
  OR NEW."candidateId" IS NOT OLD."candidateId"
BEGIN
  SELECT RAISE(ABORT, 'COMMERCIAL_CASE_ORIGIN_IMMUTABLE');
END;

CREATE TRIGGER "Candidate_origin_lineage_immutable"
BEFORE UPDATE OF "experimentId", "businessId", "status" ON "Candidate"
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM "CommercialCaseOrigin"
  WHERE "candidateId" = OLD."id"
)
AND (
  NEW."experimentId" IS NOT OLD."experimentId"
  OR NEW."businessId" IS NOT OLD."businessId"
  OR NEW."status" IS NOT OLD."status"
)
BEGIN
  SELECT RAISE(ABORT, 'CANDIDATE_ORIGIN_LINEAGE_IMMUTABLE');
END;

CREATE TRIGGER "CommercialCase_origin_identity_immutable"
BEFORE UPDATE OF "experimentId", "businessId" ON "CommercialCase"
FOR EACH ROW
WHEN EXISTS (
  SELECT 1
  FROM "CommercialCaseOrigin"
  WHERE "commercialCaseId" = OLD."id"
)
AND (
  NEW."experimentId" IS NOT OLD."experimentId"
  OR NEW."businessId" IS NOT OLD."businessId"
)
BEGIN
  SELECT RAISE(ABORT, 'COMMERCIAL_CASE_ORIGIN_IDENTITY_IMMUTABLE');
END;
