ALTER TABLE foods
  DROP CONSTRAINT IF EXISTS foods_research_last_result_check;
ALTER TABLE foods
  ADD CONSTRAINT foods_research_last_result_check
  CHECK (research_last_result IS NULL OR research_last_result IN ('no_evidence', 'invalid', 'written'));
