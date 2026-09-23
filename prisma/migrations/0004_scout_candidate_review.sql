CREATE TABLE "ScoutCandidateReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "discoveryId" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "city" TEXT,
  "region" TEXT,
  "segment" TEXT,
  "websiteUrl" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "basisJson" TEXT NOT NULL,
  "unresolvedQuestionsJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'APPROVING', 'REJECTED', 'CONVERTED')),
  "leadId" TEXT,
  "reviewedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ScoutCandidateReview_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ScoutCandidateReview_sourceType_discoveryId_key"
  ON "ScoutCandidateReview"("sourceType", "discoveryId");
CREATE UNIQUE INDEX "ScoutCandidateReview_leadId_key"
  ON "ScoutCandidateReview"("leadId");
CREATE INDEX "ScoutCandidateReview_status_createdAt_idx"
  ON "ScoutCandidateReview"("status", "createdAt");
