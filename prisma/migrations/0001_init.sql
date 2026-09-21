-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL,
    "city" TEXT,
    "region" TEXT,
    "segment" TEXT,
    "websiteUrl" TEXT,
    "googleMapsUrl" TEXT,
    "instagramUrl" TEXT,
    "whatsapp" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "source" TEXT,
    "primaryService" TEXT,
    "googleRating" REAL,
    "googleReviewCount" INTEGER,
    "mainProblem" TEXT,
    "qualificationScore" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "demoUrl" TEXT,
    "videoUrl" TEXT,
    "proposalUrl" TEXT,
    "lastContactAt" DATETIME,
    "nextFollowUpAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "channel" TEXT,
    "note" TEXT NOT NULL,
    CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT,
    "clientName" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "totalAmountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATETIME,
    "completionDate" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" DATETIME NOT NULL,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_nextFollowUpAt_idx" ON "Lead"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_leadId_idx" ON "Project"("leadId");

-- CreateIndex
CREATE INDEX "Payment_projectId_paidAt_idx" ON "Payment"("projectId", "paidAt");
