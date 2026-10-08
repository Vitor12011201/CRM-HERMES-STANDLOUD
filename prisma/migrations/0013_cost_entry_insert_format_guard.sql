-- TR-04 CostEntry physical-format guard. This is additive and applies only
-- to future inserts; it does not rewrite immutable historical CostEntry rows.
CREATE TRIGGER "CostEntry_insert_format_guard"
BEFORE INSERT ON "CostEntry"
FOR EACH ROW
WHEN CASE
  WHEN
    typeof(NEW."canonicalCostEntrySha256") = 'text'
    AND length(NEW."canonicalCostEntrySha256") = 64
    AND length(CAST(NEW."canonicalCostEntrySha256" AS BLOB)) = 64
    AND instr(NEW."canonicalCostEntrySha256", char(0)) = 0
    AND NEW."canonicalCostEntrySha256" NOT GLOB '*[^0-9a-f]*'
    AND typeof(NEW."measurementBasisSha256") = 'text'
    AND length(NEW."measurementBasisSha256") = 64
    AND length(CAST(NEW."measurementBasisSha256" AS BLOB)) = 64
    AND instr(NEW."measurementBasisSha256", char(0)) = 0
    AND NEW."measurementBasisSha256" NOT GLOB '*[^0-9a-f]*'
    AND (
      NEW."evidenceSha256" IS NULL
      OR (
        typeof(NEW."evidenceSha256") = 'text'
        AND length(NEW."evidenceSha256") = 64
        AND length(CAST(NEW."evidenceSha256" AS BLOB)) = 64
        AND instr(NEW."evidenceSha256", char(0)) = 0
        AND NEW."evidenceSha256" NOT GLOB '*[^0-9a-f]*'
      )
    )
    AND (
      (
        NEW."monetaryKnowledge" = 'KNOWN'
        AND typeof(NEW."currency") = 'text'
        AND length(NEW."currency") = 3
        AND length(CAST(NEW."currency" AS BLOB)) = 3
        AND instr(NEW."currency", char(0)) = 0
        AND NEW."currency" NOT GLOB '*[^A-Z]*'
      )
      OR (NEW."monetaryKnowledge" = 'UNKNOWN' AND NEW."currency" IS NULL)
    )
  THEN 0
  ELSE 1
END
BEGIN
  SELECT RAISE(ABORT, 'COST_ENTRY_INSERT_FORMAT_INVALID');
END;
