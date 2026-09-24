CREATE TABLE "AgentConfig" (
  "technicalId" TEXT NOT NULL PRIMARY KEY,
  "activePromptVersion" INTEGER CHECK ("activePromptVersion" IS NULL OR "activePromptVersion" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AgentPromptVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "technicalId" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "content" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentPromptVersion_technicalId_fkey" FOREIGN KEY ("technicalId") REFERENCES "AgentConfig" ("technicalId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentPromptVersion_technicalId_version_key"
  ON "AgentPromptVersion"("technicalId", "version");
CREATE INDEX "AgentPromptVersion_technicalId_createdAt_idx"
  ON "AgentPromptVersion"("technicalId", "createdAt");
