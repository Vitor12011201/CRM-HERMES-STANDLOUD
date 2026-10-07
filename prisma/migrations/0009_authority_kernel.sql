CREATE TABLE "AuthorityBootstrapReceipt" (
  "bootstrapKey" TEXT NOT NULL PRIMARY KEY,
  "manifestVersion" TEXT NOT NULL UNIQUE,
  "manifestSha256" TEXT NOT NULL UNIQUE,
  "manifestSourceRef" TEXT NOT NULL,
  "principalActorId" TEXT NOT NULL UNIQUE,
  "provisionedAt" DATETIME NOT NULL,
  CONSTRAINT "AuthorityBootstrapReceipt_principalActorId_fkey"
    FOREIGN KEY ("principalActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("bootstrapKey" = 'AUTHORITY_BOOTSTRAP_V1'),
  CHECK (length("manifestVersion") > 0 AND instr("manifestVersion", char(0)) = 0),
  CHECK (length("manifestSha256") = 64 AND "manifestSha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("manifestSourceRef") > 0 AND instr("manifestSourceRef", char(0)) = 0),
  CHECK (julianday("provisionedAt") IS NOT NULL)
);

CREATE TABLE "AuthoritySubjectRef" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "registryVersion" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "versionKind" TEXT NOT NULL CHECK ("versionKind" IN ('NON_VERSIONED', 'EXACT_VERSION')),
  "versionToken" TEXT,
  "descriptorFormat" TEXT NOT NULL,
  "canonicalKey" TEXT NOT NULL UNIQUE,
  "descriptorSha256" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length("id") > 0 AND instr("id", char(0)) = 0),
  CHECK (length("registryVersion") > 0 AND instr("registryVersion", char(0)) = 0),
  CHECK (length("subjectType") > 0 AND instr("subjectType", char(0)) = 0),
  CHECK (length("subjectId") > 0 AND instr("subjectId", char(0)) = 0),
  CHECK (length("descriptorFormat") > 0 AND instr("descriptorFormat", char(0)) = 0),
  CHECK (length("canonicalKey") > 0 AND instr("canonicalKey", char(0)) = 0),
  CHECK (
    ("versionKind" = 'NON_VERSIONED' AND "versionToken" IS NULL)
    OR
    ("versionKind" = 'EXACT_VERSION' AND "versionToken" IS NOT NULL AND length("versionToken") > 0 AND instr("versionToken", char(0)) = 0)
  ),
  CHECK (length("descriptorSha256") = 64 AND "descriptorSha256" NOT GLOB '*[^0-9a-f]*')
);

CREATE INDEX "AuthoritySubjectRef_subjectType_subjectId_idx"
  ON "AuthoritySubjectRef"("subjectType", "subjectId");

CREATE TABLE "AuthorityPolicyVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policyKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "predecessorPolicyVersionId" TEXT,
  "recordKind" TEXT NOT NULL CHECK ("recordKind" IN ('POLICY', 'REVOCATION')),
  "normativeActionKey" TEXT NOT NULL,
  "authorityMode" TEXT NOT NULL CHECK ("authorityMode" IN ('POLICY_GOVERNED', 'DELEGATED', 'HUMAN_GATED')),
  "scopeSchemaKey" TEXT NOT NULL,
  "scopeSchemaVersion" TEXT NOT NULL,
  "definitionJson" TEXT,
  "contentSha256" TEXT NOT NULL,
  "priorDecisionDisposition" TEXT NOT NULL CHECK ("priorDecisionDisposition" IN ('PRESERVE', 'INVALIDATE')),
  "bootstrapKey" TEXT,
  "governanceDecisionId" TEXT,
  "reasonCode" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthorityPolicyVersion_predecessorPolicyVersionId_fkey"
    FOREIGN KEY ("predecessorPolicyVersionId") REFERENCES "AuthorityPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityPolicyVersion_bootstrapKey_fkey"
    FOREIGN KEY ("bootstrapKey") REFERENCES "AuthorityBootstrapReceipt"("bootstrapKey") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityPolicyVersion_governanceDecisionId_fkey"
    FOREIGN KEY ("governanceDecisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityPolicyVersion_policyKey_revision_key" UNIQUE ("policyKey", "revision"),
  CHECK (length("id") > 0 AND instr("id", char(0)) = 0),
  CHECK (length("policyKey") > 0 AND instr("policyKey", char(0)) = 0),
  CHECK (length("normativeActionKey") > 0 AND instr("normativeActionKey", char(0)) = 0),
  CHECK (length("scopeSchemaKey") > 0 AND instr("scopeSchemaKey", char(0)) = 0),
  CHECK (length("scopeSchemaVersion") > 0 AND instr("scopeSchemaVersion", char(0)) = 0),
  CHECK (length("contentSha256") = 64 AND "contentSha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK ("definitionJson" IS NULL OR (length("definitionJson") <= 32768 AND json_valid("definitionJson"))),
  CHECK (
    ("revision" = 1 AND "predecessorPolicyVersionId" IS NULL AND "recordKind" = 'POLICY'
      AND "bootstrapKey" IS NOT NULL AND "governanceDecisionId" IS NULL AND "definitionJson" IS NOT NULL
      AND "priorDecisionDisposition" = 'PRESERVE' AND "reasonCode" IS NULL)
    OR
    ("revision" > 1 AND "predecessorPolicyVersionId" IS NOT NULL AND "recordKind" = 'POLICY'
      AND "bootstrapKey" IS NULL AND "governanceDecisionId" IS NOT NULL AND "definitionJson" IS NOT NULL
      AND "reasonCode" IS NULL)
    OR
    ("revision" > 1 AND "predecessorPolicyVersionId" IS NOT NULL AND "recordKind" = 'REVOCATION'
      AND "bootstrapKey" IS NULL AND "governanceDecisionId" IS NOT NULL AND "definitionJson" IS NULL
      AND "priorDecisionDisposition" = 'INVALIDATE' AND "reasonCode" IS NOT NULL AND length("reasonCode") > 0
      AND instr("reasonCode", char(0)) = 0)
  )
);

CREATE UNIQUE INDEX "AuthorityPolicyVersion_one_successor_per_predecessor"
  ON "AuthorityPolicyVersion"("predecessorPolicyVersionId")
  WHERE "predecessorPolicyVersionId" IS NOT NULL;
CREATE INDEX "AuthorityPolicyVersion_policyKey_predecessor_idx"
  ON "AuthorityPolicyVersion"("policyKey", "predecessorPolicyVersionId");

CREATE TABLE "ExecutorEligibilityRuleSetVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ruleSetKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "predecessorRuleSetVersionId" TEXT,
  "recordKind" TEXT NOT NULL CHECK ("recordKind" IN ('RULESET', 'DISABLED')),
  "contractCatalogRevision" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "bootstrapKey" TEXT,
  "governanceDecisionId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutorEligibilityRuleSetVersion_predecessorRuleSetVersionId_fkey"
    FOREIGN KEY ("predecessorRuleSetVersionId") REFERENCES "ExecutorEligibilityRuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExecutorEligibilityRuleSetVersion_bootstrapKey_fkey"
    FOREIGN KEY ("bootstrapKey") REFERENCES "AuthorityBootstrapReceipt"("bootstrapKey") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExecutorEligibilityRuleSetVersion_governanceDecisionId_fkey"
    FOREIGN KEY ("governanceDecisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExecutorEligibilityRuleSetVersion_ruleSetKey_revision_key" UNIQUE ("ruleSetKey", "revision"),
  CHECK (length("id") > 0 AND instr("id", char(0)) = 0),
  CHECK (length("ruleSetKey") > 0 AND instr("ruleSetKey", char(0)) = 0),
  CHECK (length("contractCatalogRevision") > 0 AND instr("contractCatalogRevision", char(0)) = 0),
  CHECK (length("contentSha256") = 64 AND "contentSha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    ("revision" = 1 AND "predecessorRuleSetVersionId" IS NULL AND "recordKind" = 'RULESET'
      AND "bootstrapKey" IS NOT NULL AND "governanceDecisionId" IS NULL)
    OR
    ("revision" > 1 AND "predecessorRuleSetVersionId" IS NOT NULL AND "recordKind" = 'RULESET'
      AND "bootstrapKey" IS NULL AND "governanceDecisionId" IS NOT NULL)
    OR
    ("revision" > 1 AND "predecessorRuleSetVersionId" IS NOT NULL AND "recordKind" = 'DISABLED'
      AND "bootstrapKey" IS NULL AND "governanceDecisionId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ExecutorEligibilityRuleSetVersion_one_successor_per_predecessor"
  ON "ExecutorEligibilityRuleSetVersion"("predecessorRuleSetVersionId")
  WHERE "predecessorRuleSetVersionId" IS NOT NULL;
CREATE INDEX "ExecutorEligibilityRuleSetVersion_ruleSetKey_predecessor_idx"
  ON "ExecutorEligibilityRuleSetVersion"("ruleSetKey", "predecessorRuleSetVersionId");

CREATE TABLE "ExecutorEligibilityRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ruleSetVersionId" TEXT NOT NULL,
  "capabilityKey" TEXT NOT NULL,
  "contractVariantKey" TEXT NOT NULL,
  "executorType" TEXT NOT NULL CHECK ("executorType" IN ('HUMAN_EXECUTOR', 'DETERMINISTIC_SYSTEM', 'REASONING_AI', 'TOOL_ENABLED_AI')),
  "verdict" TEXT NOT NULL CHECK ("verdict" IN ('ELIGIBLE', 'CONDITIONAL', 'INELIGIBLE')),
  "conditionsSchemaKey" TEXT,
  "conditionsJson" TEXT,
  "ruleSha256" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutorEligibilityRule_ruleSetVersionId_fkey"
    FOREIGN KEY ("ruleSetVersionId") REFERENCES "ExecutorEligibilityRuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ExecutorEligibilityRule_ruleSet_capability_variant_executor_key"
    UNIQUE ("ruleSetVersionId", "capabilityKey", "contractVariantKey", "executorType"),
  CONSTRAINT "ExecutorEligibilityRule_id_ruleSetVersionId_key" UNIQUE ("id", "ruleSetVersionId"),
  CHECK (length("id") > 0 AND instr("id", char(0)) = 0),
  CHECK (length("capabilityKey") > 0 AND instr("capabilityKey", char(0)) = 0),
  CHECK (length("contractVariantKey") > 0 AND instr("contractVariantKey", char(0)) = 0),
  CHECK (length("ruleSha256") = 64 AND "ruleSha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    ("verdict" = 'CONDITIONAL' AND "conditionsSchemaKey" IS NOT NULL AND length("conditionsSchemaKey") > 0
      AND instr("conditionsSchemaKey", char(0)) = 0 AND "conditionsJson" IS NOT NULL
      AND length("conditionsJson") <= 32768 AND json_valid("conditionsJson"))
    OR
    ("verdict" IN ('ELIGIBLE', 'INELIGIBLE') AND "conditionsSchemaKey" IS NULL AND "conditionsJson" IS NULL)
  )
);

CREATE TABLE "Decision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "decisionRequestKey" TEXT NOT NULL UNIQUE,
  "normativeActionKey" TEXT NOT NULL,
  "outcomeKey" TEXT NOT NULL,
  "decidingActorId" TEXT NOT NULL,
  "subjectRefId" TEXT NOT NULL,
  "scopeRootSubjectRefId" TEXT,
  "basisPolicyVersionId" TEXT NOT NULL,
  "basisDelegationGrantId" TEXT,
  "conditionsSchemaKey" TEXT,
  "conditionsJson" TEXT,
  "conditionsSha256" TEXT,
  "issuedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Decision_decidingActorId_fkey"
    FOREIGN KEY ("decidingActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "Decision_subjectRefId_fkey"
    FOREIGN KEY ("subjectRefId") REFERENCES "AuthoritySubjectRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "Decision_scopeRootSubjectRefId_fkey"
    FOREIGN KEY ("scopeRootSubjectRefId") REFERENCES "AuthoritySubjectRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "Decision_basisPolicyVersionId_fkey"
    FOREIGN KEY ("basisPolicyVersionId") REFERENCES "AuthorityPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "Decision_basisDelegationGrantId_fkey"
    FOREIGN KEY ("basisDelegationGrantId") REFERENCES "DelegationGrant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (length("id") > 0 AND instr("id", char(0)) = 0),
  CHECK (length("decisionRequestKey") > 0 AND instr("decisionRequestKey", char(0)) = 0),
  CHECK (length("normativeActionKey") > 0 AND instr("normativeActionKey", char(0)) = 0),
  CHECK (length("outcomeKey") > 0 AND instr("outcomeKey", char(0)) = 0),
  CHECK (
    ("conditionsJson" IS NULL AND "conditionsSchemaKey" IS NULL AND "conditionsSha256" IS NULL)
    OR
    ("conditionsJson" IS NOT NULL AND length("conditionsJson") <= 32768 AND json_valid("conditionsJson")
      AND "conditionsSchemaKey" IS NOT NULL AND length("conditionsSchemaKey") > 0 AND instr("conditionsSchemaKey", char(0)) = 0
      AND "conditionsSha256" IS NOT NULL AND length("conditionsSha256") = 64 AND "conditionsSha256" NOT GLOB '*[^0-9a-f]*')
  ),
  CHECK (julianday("issuedAt") IS NOT NULL)
);

CREATE INDEX "Decision_subjectRefId_normativeActionKey_idx"
  ON "Decision"("subjectRefId", "normativeActionKey");
CREATE INDEX "Decision_basisPolicyVersionId_idx"
  ON "Decision"("basisPolicyVersionId");

CREATE TABLE "DelegationGrant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "grantRequestKey" TEXT NOT NULL UNIQUE,
  "grantedPolicyVersionId" TEXT NOT NULL,
  "delegatorActorId" TEXT,
  "delegateActorId" TEXT NOT NULL,
  "scopeRootSubjectRefId" TEXT NOT NULL,
  "scopeSchemaKey" TEXT NOT NULL,
  "scopeJson" TEXT,
  "scopeSha256" TEXT,
  "validFrom" DATETIME NOT NULL,
  "validUntil" DATETIME,
  "grantingPolicyVersionId" TEXT,
  "grantingDecisionId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DelegationGrant_grantedPolicyVersionId_fkey"
    FOREIGN KEY ("grantedPolicyVersionId") REFERENCES "AuthorityPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DelegationGrant_delegatorActorId_fkey"
    FOREIGN KEY ("delegatorActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DelegationGrant_delegateActorId_fkey"
    FOREIGN KEY ("delegateActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DelegationGrant_scopeRootSubjectRefId_fkey"
    FOREIGN KEY ("scopeRootSubjectRefId") REFERENCES "AuthoritySubjectRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DelegationGrant_grantingPolicyVersionId_fkey"
    FOREIGN KEY ("grantingPolicyVersionId") REFERENCES "AuthorityPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "DelegationGrant_grantingDecisionId_fkey"
    FOREIGN KEY ("grantingDecisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (length("id") > 0 AND instr("id", char(0)) = 0),
  CHECK (length("grantRequestKey") > 0 AND instr("grantRequestKey", char(0)) = 0),
  CHECK (length("scopeSchemaKey") > 0 AND instr("scopeSchemaKey", char(0)) = 0),
  CHECK (
    ("scopeJson" IS NULL AND "scopeSha256" IS NULL)
    OR
    ("scopeJson" IS NOT NULL AND length("scopeJson") <= 32768 AND json_valid("scopeJson")
      AND "scopeSha256" IS NOT NULL AND length("scopeSha256") = 64 AND "scopeSha256" NOT GLOB '*[^0-9a-f]*')
  ),
  CHECK (
    ("grantingPolicyVersionId" IS NOT NULL AND "grantingDecisionId" IS NULL)
    OR
    ("grantingPolicyVersionId" IS NULL AND "grantingDecisionId" IS NOT NULL)
  ),
  CHECK (julianday("validFrom") IS NOT NULL),
  CHECK ("validUntil" IS NULL OR (julianday("validUntil") IS NOT NULL AND julianday("validUntil") > julianday("validFrom")))
);

CREATE INDEX "DelegationGrant_delegateActorId_grantedPolicy_validFrom_idx"
  ON "DelegationGrant"("delegateActorId", "grantedPolicyVersionId", "validFrom");

CREATE TABLE "AuthorityRelation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "effectingDecisionId" TEXT NOT NULL,
  "relationKind" TEXT NOT NULL CHECK ("relationKind" IN ('SUPERSEDES', 'REVOKES')),
  "targetDecisionId" TEXT,
  "targetDelegationGrantId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthorityRelation_effectingDecisionId_fkey"
    FOREIGN KEY ("effectingDecisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityRelation_targetDecisionId_fkey"
    FOREIGN KEY ("targetDecisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityRelation_targetDelegationGrantId_fkey"
    FOREIGN KEY ("targetDelegationGrantId") REFERENCES "DelegationGrant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (length("id") > 0 AND instr("id", char(0)) = 0),
  CHECK (("targetDecisionId" IS NOT NULL AND "targetDelegationGrantId" IS NULL) OR ("targetDecisionId" IS NULL AND "targetDelegationGrantId" IS NOT NULL))
);

CREATE UNIQUE INDEX "AuthorityRelation_exact_decision_relation_key"
  ON "AuthorityRelation"("effectingDecisionId", "relationKind", "targetDecisionId")
  WHERE "targetDecisionId" IS NOT NULL;
CREATE UNIQUE INDEX "AuthorityRelation_exact_delegation_relation_key"
  ON "AuthorityRelation"("effectingDecisionId", "relationKind", "targetDelegationGrantId")
  WHERE "targetDelegationGrantId" IS NOT NULL;
CREATE UNIQUE INDEX "AuthorityRelation_one_supersedes_decision_target"
  ON "AuthorityRelation"("targetDecisionId")
  WHERE "relationKind" = 'SUPERSEDES' AND "targetDecisionId" IS NOT NULL;
CREATE UNIQUE INDEX "AuthorityRelation_one_supersedes_delegation_target"
  ON "AuthorityRelation"("targetDelegationGrantId")
  WHERE "relationKind" = 'SUPERSEDES' AND "targetDelegationGrantId" IS NOT NULL;
CREATE INDEX "AuthorityRelation_targetDecisionId_idx" ON "AuthorityRelation"("targetDecisionId");
CREATE INDEX "AuthorityRelation_targetDelegationGrantId_idx" ON "AuthorityRelation"("targetDelegationGrantId");

CREATE TABLE "AuthorityInvocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "invocationKey" TEXT NOT NULL UNIQUE,
  "canonicalRequestSha256" TEXT NOT NULL,
  "normativeActionKey" TEXT NOT NULL,
  "capabilityKey" TEXT NOT NULL,
  "contractVariantKey" TEXT,
  "executorActorId" TEXT NOT NULL,
  "executorType" TEXT NOT NULL CHECK ("executorType" IN ('HUMAN_EXECUTOR', 'DETERMINISTIC_SYSTEM', 'REASONING_AI', 'TOOL_ENABLED_AI')),
  "subjectRefId" TEXT NOT NULL,
  "caseSubjectRefId" TEXT,
  "policyVersionId" TEXT NOT NULL,
  "eligibilityRuleSetVersionId" TEXT NOT NULL,
  "eligibilityRuleId" TEXT NOT NULL,
  "decisionId" TEXT,
  "delegationGrantId" TEXT,
  "outcome" TEXT NOT NULL CHECK ("outcome" = 'AUTHORIZED'),
  "lineageSha256" TEXT NOT NULL,
  "evaluatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthorityInvocation_executorActorId_fkey"
    FOREIGN KEY ("executorActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityInvocation_subjectRefId_fkey"
    FOREIGN KEY ("subjectRefId") REFERENCES "AuthoritySubjectRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityInvocation_caseSubjectRefId_fkey"
    FOREIGN KEY ("caseSubjectRefId") REFERENCES "AuthoritySubjectRef"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityInvocation_policyVersionId_fkey"
    FOREIGN KEY ("policyVersionId") REFERENCES "AuthorityPolicyVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityInvocation_eligibilityRuleSetVersionId_fkey"
    FOREIGN KEY ("eligibilityRuleSetVersionId") REFERENCES "ExecutorEligibilityRuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityInvocation_eligibilityRuleId_eligibilityRuleSetVersionId_fkey"
    FOREIGN KEY ("eligibilityRuleId", "eligibilityRuleSetVersionId") REFERENCES "ExecutorEligibilityRule"("id", "ruleSetVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityInvocation_decisionId_fkey"
    FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthorityInvocation_delegationGrantId_fkey"
    FOREIGN KEY ("delegationGrantId") REFERENCES "DelegationGrant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (length("id") > 0 AND instr("id", char(0)) = 0),
  CHECK (length("invocationKey") > 0 AND instr("invocationKey", char(0)) = 0),
  CHECK (length("normativeActionKey") > 0 AND instr("normativeActionKey", char(0)) = 0),
  CHECK (length("capabilityKey") > 0 AND instr("capabilityKey", char(0)) = 0),
  CHECK (length("canonicalRequestSha256") = 64 AND "canonicalRequestSha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK (length("lineageSha256") = 64 AND "lineageSha256" NOT GLOB '*[^0-9a-f]*'),
  CHECK (julianday("evaluatedAt") IS NOT NULL)
);

CREATE INDEX "AuthorityInvocation_subjectRefId_normativeActionKey_idx"
  ON "AuthorityInvocation"("subjectRefId", "normativeActionKey");
CREATE INDEX "AuthorityInvocation_policyVersionId_idx"
  ON "AuthorityInvocation"("policyVersionId");

CREATE TRIGGER "AuthorityPolicyVersion_predecessor_guard"
BEFORE INSERT ON "AuthorityPolicyVersion"
FOR EACH ROW
WHEN NEW."predecessorPolicyVersionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'AUTHORITY_POLICY_PREDECESSOR_MISMATCH')
  WHERE NOT EXISTS (
    SELECT 1 FROM "AuthorityPolicyVersion" AS "predecessor"
    WHERE "predecessor"."id" = NEW."predecessorPolicyVersionId"
      AND "predecessor"."policyKey" = NEW."policyKey"
      AND NEW."revision" = "predecessor"."revision" + 1
      AND "predecessor"."normativeActionKey" = NEW."normativeActionKey"
      AND "predecessor"."authorityMode" = NEW."authorityMode"
  );

  SELECT RAISE(ABORT, 'AUTHORITY_POLICY_GOVERNANCE_DESCRIPTOR_MISMATCH')
  WHERE NOT EXISTS (
    SELECT 1
    FROM "Decision" AS "decision"
    INNER JOIN "AuthoritySubjectRef" AS "subject" ON "subject"."id" = "decision"."subjectRefId"
    WHERE "decision"."id" = NEW."governanceDecisionId"
      AND "decision"."normativeActionKey" = 'AUTHORITY_POLICY_GOVERNANCE'
      AND "decision"."conditionsSchemaKey" = 'authority-kernel-governance-proposal/v1'
      AND "subject"."subjectType" = 'POLICY_FAMILY_DESCRIPTOR'
      AND "subject"."subjectId" = NEW."policyKey"
      AND "subject"."versionKind" = 'EXACT_VERSION'
      AND "subject"."versionToken" = NEW."predecessorPolicyVersionId"
      AND json_extract("decision"."conditionsJson", '$.familyKind') = 'POLICY'
      AND json_extract("decision"."conditionsJson", '$.familyKey') = NEW."policyKey"
      AND json_extract("decision"."conditionsJson", '$.expectedPredecessorId') = NEW."predecessorPolicyVersionId"
      AND json_extract("decision"."conditionsJson", '$.nextRevision') = NEW."revision"
      AND json_extract("decision"."conditionsJson", '$.recordKind') = NEW."recordKind"
      AND json_extract("decision"."conditionsJson", '$.proposedContentSha256') = NEW."contentSha256"
  );
END;

CREATE TRIGGER "ExecutorEligibilityRuleSetVersion_predecessor_guard"
BEFORE INSERT ON "ExecutorEligibilityRuleSetVersion"
FOR EACH ROW
WHEN NEW."predecessorRuleSetVersionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'ELIGIBILITY_RULESET_PREDECESSOR_MISMATCH')
  WHERE NOT EXISTS (
    SELECT 1 FROM "ExecutorEligibilityRuleSetVersion" AS "predecessor"
    WHERE "predecessor"."id" = NEW."predecessorRuleSetVersionId"
      AND "predecessor"."ruleSetKey" = NEW."ruleSetKey"
      AND NEW."revision" = "predecessor"."revision" + 1
  );

  SELECT RAISE(ABORT, 'ELIGIBILITY_RULESET_GOVERNANCE_DESCRIPTOR_MISMATCH')
  WHERE NOT EXISTS (
    SELECT 1
    FROM "Decision" AS "decision"
    INNER JOIN "AuthoritySubjectRef" AS "subject" ON "subject"."id" = "decision"."subjectRefId"
    WHERE "decision"."id" = NEW."governanceDecisionId"
      AND "decision"."normativeActionKey" = 'AUTHORITY_POLICY_GOVERNANCE'
      AND "decision"."conditionsSchemaKey" = 'authority-kernel-governance-proposal/v1'
      AND "subject"."subjectType" = 'ELIGIBILITY_RULESET_FAMILY_DESCRIPTOR'
      AND "subject"."subjectId" = NEW."ruleSetKey"
      AND "subject"."versionKind" = 'EXACT_VERSION'
      AND "subject"."versionToken" = NEW."predecessorRuleSetVersionId"
      AND json_extract("decision"."conditionsJson", '$.familyKind') = 'ELIGIBILITY_RULESET'
      AND json_extract("decision"."conditionsJson", '$.familyKey') = NEW."ruleSetKey"
      AND json_extract("decision"."conditionsJson", '$.expectedPredecessorId') = NEW."predecessorRuleSetVersionId"
      AND json_extract("decision"."conditionsJson", '$.nextRevision') = NEW."revision"
      AND json_extract("decision"."conditionsJson", '$.recordKind') = NEW."recordKind"
      AND json_extract("decision"."conditionsJson", '$.proposedContentSha256') = NEW."contentSha256"
  );
END;

CREATE TRIGGER "ExecutorEligibilityRule_parent_ruleset_guard"
BEFORE INSERT ON "ExecutorEligibilityRule"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ELIGIBILITY_RULE_PARENT_NOT_RULESET')
  WHERE NOT EXISTS (
    SELECT 1 FROM "ExecutorEligibilityRuleSetVersion"
    WHERE "id" = NEW."ruleSetVersionId" AND "recordKind" = 'RULESET'
  );
END;

CREATE TRIGGER "AuthorityRelation_self_target_guard"
BEFORE INSERT ON "AuthorityRelation"
FOR EACH ROW
WHEN NEW."targetDecisionId" IS NOT NULL AND NEW."effectingDecisionId" = NEW."targetDecisionId"
BEGIN
  SELECT RAISE(ABORT, 'AUTHORITY_RELATION_SELF_TARGET');
END;

CREATE TRIGGER "AuthorityRelation_supersedes_cycle_guard"
BEFORE INSERT ON "AuthorityRelation"
FOR EACH ROW
WHEN NEW."relationKind" = 'SUPERSEDES' AND NEW."targetDecisionId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'AUTHORITY_RELATION_SUPERSEDES_CYCLE')
  WHERE EXISTS (
    WITH RECURSIVE "descendants"("id") AS (
      SELECT "targetDecisionId"
      FROM "AuthorityRelation"
      WHERE "relationKind" = 'SUPERSEDES'
        AND "effectingDecisionId" = NEW."targetDecisionId"
        AND "targetDecisionId" IS NOT NULL
      UNION ALL
      SELECT "relation"."targetDecisionId"
      FROM "AuthorityRelation" AS "relation"
      INNER JOIN "descendants" ON "relation"."effectingDecisionId" = "descendants"."id"
      WHERE "relation"."relationKind" = 'SUPERSEDES'
        AND "relation"."targetDecisionId" IS NOT NULL
    )
    SELECT 1 FROM "descendants" WHERE "id" = NEW."effectingDecisionId"
  );
END;

CREATE TRIGGER "AuthorityInvocation_generic_guard"
BEFORE INSERT ON "AuthorityInvocation"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_EXTERNAL_PARTY_EXECUTOR')
  WHERE EXISTS (
    SELECT 1 FROM "Actor"
    WHERE "id" = NEW."executorActorId" AND "category" = 'EXTERNAL_PARTY'
  );

  SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_RULESET_NOT_CURRENT')
  WHERE NOT EXISTS (
    SELECT 1
    FROM "ExecutorEligibilityRuleSetVersion" AS "ruleSet"
    WHERE "ruleSet"."id" = NEW."eligibilityRuleSetVersionId"
      AND "ruleSet"."recordKind" = 'RULESET'
      AND NOT EXISTS (
        SELECT 1 FROM "ExecutorEligibilityRuleSetVersion" AS "successor"
        WHERE "successor"."predecessorRuleSetVersionId" = "ruleSet"."id"
      )
  );

  SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_RULE_MISMATCH')
  WHERE NOT EXISTS (
    SELECT 1
    FROM "ExecutorEligibilityRule" AS "rule"
    WHERE "rule"."id" = NEW."eligibilityRuleId"
      AND "rule"."ruleSetVersionId" = NEW."eligibilityRuleSetVersionId"
      AND "rule"."capabilityKey" = NEW."capabilityKey"
      AND "rule"."contractVariantKey" = COALESCE(NEW."contractVariantKey", 'DEFAULT')
      AND "rule"."executorType" = NEW."executorType"
      AND "rule"."verdict" = 'ELIGIBLE'
  );

  SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_POLICY_GOVERNED_MISMATCH')
  WHERE NEW."decisionId" IS NULL AND NEW."delegationGrantId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "AuthorityPolicyVersion" AS "policy"
      WHERE "policy"."id" = NEW."policyVersionId"
        AND "policy"."recordKind" = 'POLICY'
        AND "policy"."authorityMode" = 'POLICY_GOVERNED'
        AND "policy"."normativeActionKey" = NEW."normativeActionKey"
        AND NOT EXISTS (
          SELECT 1 FROM "AuthorityPolicyVersion" AS "successor"
          WHERE "successor"."predecessorPolicyVersionId" = "policy"."id"
        )
    );

  SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_HUMAN_GATED_MISMATCH')
  WHERE NEW."decisionId" IS NOT NULL AND NEW."delegationGrantId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "Decision" AS "decision"
      INNER JOIN "AuthorityPolicyVersion" AS "policy" ON "policy"."id" = "decision"."basisPolicyVersionId"
      WHERE "decision"."id" = NEW."decisionId"
        AND "decision"."basisPolicyVersionId" = NEW."policyVersionId"
        AND "decision"."normativeActionKey" = NEW."normativeActionKey"
        AND "decision"."subjectRefId" = NEW."subjectRefId"
        AND "policy"."recordKind" = 'POLICY'
        AND "policy"."authorityMode" = 'HUMAN_GATED'
        AND "policy"."normativeActionKey" = NEW."normativeActionKey"
        AND NOT EXISTS (
          SELECT 1 FROM "AuthorityRelation"
          WHERE "targetDecisionId" = "decision"."id"
        )
    );

  SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_DELEGATED_MISMATCH')
  WHERE NEW."delegationGrantId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "DelegationGrant" AS "delegation"
      INNER JOIN "AuthorityPolicyVersion" AS "policy" ON "policy"."id" = "delegation"."grantedPolicyVersionId"
      WHERE "delegation"."id" = NEW."delegationGrantId"
        AND "delegation"."grantedPolicyVersionId" = NEW."policyVersionId"
        AND "delegation"."delegateActorId" = NEW."executorActorId"
        AND "policy"."recordKind" = 'POLICY'
        AND "policy"."authorityMode" = 'DELEGATED'
        AND "policy"."normativeActionKey" = NEW."normativeActionKey"
        AND julianday(NEW."evaluatedAt") >= julianday("delegation"."validFrom")
        AND ("delegation"."validUntil" IS NULL OR julianday(NEW."evaluatedAt") < julianday("delegation"."validUntil"))
        AND NOT EXISTS (
          SELECT 1 FROM "AuthorityRelation"
          WHERE "targetDelegationGrantId" = "delegation"."id"
        )
    );

  SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_DELEGATED_DECISION_MISMATCH')
  WHERE NEW."delegationGrantId" IS NOT NULL AND NEW."decisionId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Decision"
      WHERE "id" = NEW."decisionId"
        AND "basisPolicyVersionId" = NEW."policyVersionId"
        AND "basisDelegationGrantId" = NEW."delegationGrantId"
        AND "normativeActionKey" = NEW."normativeActionKey"
        AND "subjectRefId" = NEW."subjectRefId"
    );

  SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_DECISION_POLICY_INVALIDATED')
  WHERE NEW."decisionId" IS NOT NULL
    AND EXISTS (
      WITH RECURSIVE "successors"("id", "recordKind", "priorDecisionDisposition") AS (
        SELECT "id", "recordKind", "priorDecisionDisposition"
        FROM "AuthorityPolicyVersion"
        WHERE "predecessorPolicyVersionId" = NEW."policyVersionId"
        UNION ALL
        SELECT "policy"."id", "policy"."recordKind", "policy"."priorDecisionDisposition"
        FROM "AuthorityPolicyVersion" AS "policy"
        INNER JOIN "successors" ON "policy"."predecessorPolicyVersionId" = "successors"."id"
      )
      SELECT 1 FROM "successors"
      WHERE "recordKind" = 'REVOCATION' OR "priorDecisionDisposition" = 'INVALIDATE'
    );
END;

CREATE TRIGGER "AuthorityBootstrapReceipt_update_forbidden"
BEFORE UPDATE ON "AuthorityBootstrapReceipt"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_BOOTSTRAP_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER "AuthorityBootstrapReceipt_delete_forbidden"
BEFORE DELETE ON "AuthorityBootstrapReceipt"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_BOOTSTRAP_RECEIPT_DELETE_FORBIDDEN'); END;
CREATE TRIGGER "AuthoritySubjectRef_update_forbidden"
BEFORE UPDATE ON "AuthoritySubjectRef"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_SUBJECT_REF_IMMUTABLE'); END;
CREATE TRIGGER "AuthoritySubjectRef_delete_forbidden"
BEFORE DELETE ON "AuthoritySubjectRef"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_SUBJECT_REF_DELETE_FORBIDDEN'); END;
CREATE TRIGGER "AuthorityPolicyVersion_update_forbidden"
BEFORE UPDATE ON "AuthorityPolicyVersion"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_POLICY_VERSION_IMMUTABLE'); END;
CREATE TRIGGER "AuthorityPolicyVersion_delete_forbidden"
BEFORE DELETE ON "AuthorityPolicyVersion"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_POLICY_VERSION_DELETE_FORBIDDEN'); END;
CREATE TRIGGER "ExecutorEligibilityRuleSetVersion_update_forbidden"
BEFORE UPDATE ON "ExecutorEligibilityRuleSetVersion"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'ELIGIBILITY_RULESET_VERSION_IMMUTABLE'); END;
CREATE TRIGGER "ExecutorEligibilityRuleSetVersion_delete_forbidden"
BEFORE DELETE ON "ExecutorEligibilityRuleSetVersion"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'ELIGIBILITY_RULESET_VERSION_DELETE_FORBIDDEN'); END;
CREATE TRIGGER "ExecutorEligibilityRule_update_forbidden"
BEFORE UPDATE ON "ExecutorEligibilityRule"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'ELIGIBILITY_RULE_IMMUTABLE'); END;
CREATE TRIGGER "ExecutorEligibilityRule_delete_forbidden"
BEFORE DELETE ON "ExecutorEligibilityRule"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'ELIGIBILITY_RULE_DELETE_FORBIDDEN'); END;
CREATE TRIGGER "Decision_update_forbidden"
BEFORE UPDATE ON "Decision"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'DECISION_IMMUTABLE'); END;
CREATE TRIGGER "Decision_delete_forbidden"
BEFORE DELETE ON "Decision"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'DECISION_DELETE_FORBIDDEN'); END;
CREATE TRIGGER "DelegationGrant_update_forbidden"
BEFORE UPDATE ON "DelegationGrant"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'DELEGATION_GRANT_IMMUTABLE'); END;
CREATE TRIGGER "DelegationGrant_delete_forbidden"
BEFORE DELETE ON "DelegationGrant"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'DELEGATION_GRANT_DELETE_FORBIDDEN'); END;
CREATE TRIGGER "AuthorityRelation_update_forbidden"
BEFORE UPDATE ON "AuthorityRelation"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_RELATION_IMMUTABLE'); END;
CREATE TRIGGER "AuthorityRelation_delete_forbidden"
BEFORE DELETE ON "AuthorityRelation"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_RELATION_DELETE_FORBIDDEN'); END;
CREATE TRIGGER "AuthorityInvocation_update_forbidden"
BEFORE UPDATE ON "AuthorityInvocation"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_IMMUTABLE'); END;
CREATE TRIGGER "AuthorityInvocation_delete_forbidden"
BEFORE DELETE ON "AuthorityInvocation"
FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_DELETE_FORBIDDEN'); END;
