ALTER TABLE foods DROP COLUMN ca_p_ratio;
ALTER TABLE foods ADD COLUMN ca_p_ratio numeric(5,3) GENERATED ALWAYS AS (
  CASE
    WHEN calcium_pct IS NOT NULL
      AND phosphorus_pct IS NOT NULL
      AND phosphorus_pct > 0
    THEN round(calcium_pct / phosphorus_pct, 3)
  END
) STORED;

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS source_conflicts jsonb NOT NULL DEFAULT '[]';

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS research_attempted_at timestamptz;
ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS research_last_result text;

ALTER TABLE foods
  DROP CONSTRAINT IF EXISTS foods_research_last_result_check;
ALTER TABLE foods
  ADD CONSTRAINT foods_research_last_result_check
  CHECK (research_last_result IS NULL OR research_last_result IN ('no_evidence', 'written'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feeding_logs_date_order_check'
  ) THEN
    ALTER TABLE feeding_logs
      ADD CONSTRAINT feeding_logs_date_order_check
      CHECK (ended_on IS NULL OR ended_on >= started_on);
  END IF;
END;
$$;
