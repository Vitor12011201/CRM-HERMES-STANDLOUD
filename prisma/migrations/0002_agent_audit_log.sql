-- CreateTable
CREATE TABLE "AgentAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL,
    "actorName" TEXT,
    "toolName" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeData" TEXT,
    "afterData" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AgentAuditLog_entityType_entityId_createdAt_idx" ON "AgentAuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAuditLog_toolName_createdAt_idx" ON "AgentAuditLog"("toolName", "createdAt");
