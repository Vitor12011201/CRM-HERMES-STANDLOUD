-- TR-03E: preserve evaluator semantics at commit time and freeze Actors as
-- durable authority carriers.  0001..0009 are published history.

CREATE TRIGGER "Actor_update_forbidden"
BEFORE UPDATE ON "Actor"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ACTOR_IMMUTABLE');
END;

CREATE TRIGGER "Actor_delete_forbidden"
BEFORE DELETE ON "Actor"
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'ACTOR_DELETE_FORBIDDEN');
END;

DROP TRIGGER "AuthorityInvocation_generic_guard";

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

  -- A Decision may follow a linear chain of POLICY/PRESERVE successors.  The
  -- recursive proof is deliberately fail-closed: anything other than a
  -- POLICY/PRESERVE link between its basis and the current structural head
  -- invalidates the human-gated invocation.
  SELECT RAISE(ABORT, 'AUTHORITY_INVOCATION_HUMAN_GATED_MISMATCH')
  WHERE NEW."decisionId" IS NOT NULL AND NEW."delegationGrantId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "Decision" AS "decision"
      INNER JOIN "Actor" AS "decidingActor" ON "decidingActor"."id" = "decision"."decidingActorId"
      INNER JOIN "AuthorityPolicyVersion" AS "basis" ON "basis"."id" = "decision"."basisPolicyVersionId"
      INNER JOIN "AuthorityPolicyVersion" AS "current" ON "current"."id" = NEW."policyVersionId"
      WHERE "decision"."id" = NEW."decisionId"
        AND "decision"."normativeActionKey" = NEW."normativeActionKey"
        AND "decision"."subjectRefId" = NEW."subjectRefId"
        AND "decision"."scopeRootSubjectRefId" IS NEW."caseSubjectRefId"
        AND "decidingActor"."category" = 'HUMAN'
        AND "basis"."recordKind" = 'POLICY'
        AND "basis"."authorityMode" = 'HUMAN_GATED'
        AND "basis"."normativeActionKey" = NEW."normativeActionKey"
        AND "basis"."policyKey" = "current"."policyKey"
        AND "current"."recordKind" = 'POLICY'
        AND "current"."authorityMode" = 'HUMAN_GATED'
        AND "current"."normativeActionKey" = NEW."normativeActionKey"
        AND NOT EXISTS (
          SELECT 1 FROM "AuthorityPolicyVersion" AS "successor"
          WHERE "successor"."predecessorPolicyVersionId" = "current"."id"
        )
        AND EXISTS (
          WITH RECURSIVE "successors"("id", "recordKind", "priorDecisionDisposition") AS (
            SELECT "id", "recordKind", "priorDecisionDisposition"
            FROM "AuthorityPolicyVersion"
            WHERE "predecessorPolicyVersionId" = "basis"."id"
            UNION ALL
            SELECT "successor"."id", "successor"."recordKind", "successor"."priorDecisionDisposition"
            FROM "AuthorityPolicyVersion" AS "successor"
            INNER JOIN "successors" ON "successor"."predecessorPolicyVersionId" = "successors"."id"
          )
          SELECT 1
          WHERE (
            "basis"."id" = "current"."id"
            OR EXISTS (SELECT 1 FROM "successors" WHERE "id" = "current"."id")
          )
            AND NOT EXISTS (
              SELECT 1 FROM "successors"
              WHERE "recordKind" <> 'POLICY' OR "priorDecisionDisposition" <> 'PRESERVE'
            )
        )
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
        AND "delegation"."scopeRootSubjectRefId" IS NEW."caseSubjectRefId"
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
