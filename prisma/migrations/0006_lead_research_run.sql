CREATE TABLE "LeadResearchRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leadId" TEXT NOT NULL,
  "technicalId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK ("status" IN ('PENDING_REVIEW', 'APPROVING', 'APPROVED', 'REJECTED')),
  "inputJson" TEXT NOT NULL,
  "snapshotsJson" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL,
  "promptSource" TEXT NOT NULL CHECK ("promptSource" IN ('BUILT_IN', 'CONFIGURED')),
  "promptVersion" INTEGER,
  "model" TEXT NOT NULL,
  "approvedEvidenceIndexesJson" TEXT,
  "reviewedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LeadResearchRun_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (("promptSource" = 'BUILT_IN' AND "promptVersion" IS NULL) OR ("promptSource" = 'CONFIGURED' AND "promptVersion" IS NOT NULL AND "promptVersion" > 0)),
  CHECK (("status" = 'PENDING_REVIEW' AND "approvedEvidenceIndexesJson" IS NULL AND "reviewedAt" IS NULL) OR ("status" = 'APPROVING' AND "approvedEvidenceIndexesJson" IS NOT NULL AND "reviewedAt" IS NULL) OR ("status" = 'APPROVED' AND "approvedEvidenceIndexesJson" IS NOT NULL AND "reviewedAt" IS NOT NULL) OR ("status" = 'REJECTED' AND "approvedEvidenceIndexesJson" IS NULL AND "reviewedAt" IS NOT NULL))
);

CREATE INDEX "LeadResearchRun_leadId_createdAt_idx" ON "LeadResearchRun"("leadId", "createdAt");
CREATE INDEX "LeadResearchRun_status_createdAt_idx" ON "LeadResearchRun"("status", "createdAt");
