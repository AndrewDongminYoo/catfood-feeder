-- Retire the autonomous-enrichment leftovers and index the two foreign keys the app
-- actually traverses.
--
-- foods.research_attempted_at / research_last_result were introduced by 0004 and had
-- their CHECK widened by 0005, but no application code has ever read or written them —
-- they belong to the autonomous web-enrichment path removed in 6a155fb. Dropping the
-- columns drops the dependent CHECK with them.
--
-- foods.weight_kg is deliberately NOT dropped: the Pet Friends ingest populates it for
-- the skeleton rows, so it holds real data and only lacks a UI.

ALTER TABLE public.foods
  DROP COLUMN IF EXISTS research_attempted_at,
  DROP COLUMN IF EXISTS research_last_result;

-- getFoods() embeds recalls on every catalog read, resolved through this FK; without an
-- index it seq-scans as the weekly openFDA sync accumulates rows.
CREATE INDEX IF NOT EXISTS recalls_food_idx
  ON public.recalls (food_id)
  WHERE food_id IS NOT NULL;

-- feeding_logs.food_id is ON DELETE RESTRICT, so every foods delete scans this table.
CREATE INDEX IF NOT EXISTS feeding_logs_food_idx
  ON public.feeding_logs (food_id);
