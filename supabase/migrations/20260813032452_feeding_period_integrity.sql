-- Keep the newest open period when historical data contains duplicates. Closing
-- older rows on the surviving period's start date preserves the date-order
-- constraint and produces a deterministic current record.
WITH ranked_open_periods AS (
  SELECT
    id,
    first_value(started_on) OVER (
      PARTITION BY cat_id
      ORDER BY started_on DESC, id DESC
    ) AS surviving_started_on,
    row_number() OVER (
      PARTITION BY cat_id
      ORDER BY started_on DESC, id DESC
    ) AS open_rank
  FROM public.feeding_logs
  WHERE ended_on IS NULL
)
UPDATE public.feeding_logs AS feeding_log
SET ended_on = ranked.surviving_started_on
FROM ranked_open_periods AS ranked
WHERE feeding_log.id = ranked.id
  AND ranked.open_rank > 1;

CREATE UNIQUE INDEX feeding_logs_one_open_per_cat_idx
  ON public.feeding_logs (cat_id)
  WHERE ended_on IS NULL;

CREATE OR REPLACE FUNCTION public.switch_current_feeding(
  p_cat_id bigint,
  p_food_id bigint,
  p_started_on date,
  p_note text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owned_cat_id bigint;
  v_current_log_id bigint;
  v_current_started_on date;
  v_new_log_id bigint;
BEGIN
  IF p_cat_id IS NULL OR p_food_id IS NULL OR p_started_on IS NULL THEN
    RAISE EXCEPTION 'Cat, food, and start date are required.'
      USING ERRCODE = '22023';
  END IF;

  -- The cat row is the serialization point for concurrent switches. RLS keeps
  -- another owner's cat invisible to this SECURITY INVOKER function.
  SELECT cat.id
    INTO v_owned_cat_id
  FROM public.cats AS cat
  WHERE cat.id = p_cat_id
    AND cat.owner_id = (SELECT auth.uid())
  FOR UPDATE;

  IF v_owned_cat_id IS NULL THEN
    RAISE EXCEPTION 'Cat is not accessible.' USING ERRCODE = '42501';
  END IF;

  SELECT feeding_log.id, feeding_log.started_on
    INTO v_current_log_id, v_current_started_on
  FROM public.feeding_logs AS feeding_log
  WHERE feeding_log.cat_id = p_cat_id
    AND feeding_log.ended_on IS NULL
  FOR UPDATE;

  IF v_current_log_id IS NOT NULL AND p_started_on < v_current_started_on THEN
    RAISE EXCEPTION 'The new period cannot predate the current period.'
      USING ERRCODE = '22023';
  END IF;

  IF v_current_log_id IS NOT NULL THEN
    UPDATE public.feeding_logs
    SET ended_on = p_started_on
    WHERE id = v_current_log_id;
  END IF;

  INSERT INTO public.feeding_logs (cat_id, food_id, started_on, note)
  VALUES (p_cat_id, p_food_id, p_started_on, p_note)
  RETURNING id INTO v_new_log_id;

  RETURN v_new_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.switch_current_feeding(bigint, bigint, date, text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.switch_current_feeding(bigint, bigint, date, text)
TO authenticated;
