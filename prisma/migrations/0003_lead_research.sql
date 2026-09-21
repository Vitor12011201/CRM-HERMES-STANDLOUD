CREATE TABLE "LeadEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leadId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "observation" TEXT NOT NULL,
  "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "capturedBy" TEXT NOT NULL DEFAULT 'USER',
  CONSTRAINT "LeadEvidence_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeadAnalysis" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leadId" TEXT NOT NULL,
  "summary" TEXT,
  "opportunity" TEXT,
  "commercialSignals" TEXT,
  "demoConcept" TEXT,
  "confidence" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL DEFAULT 'USER',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LeadAnalysis_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LeadEvidence_leadId_observedAt_idx" ON "LeadEvidence"("leadId", "observedAt");
CREATE UNIQUE INDEX "LeadAnalysis_leadId_key" ON "LeadAnalysis"("leadId");
