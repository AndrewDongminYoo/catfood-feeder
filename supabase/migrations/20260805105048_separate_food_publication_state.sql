CREATE TYPE public.food_verification_method AS ENUM (
  'legacy_human',
  'human'
);

ALTER TABLE public.foods
  ADD COLUMN published_at timestamptz,
  ADD COLUMN published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN verification_method public.food_verification_method;

UPDATE public.foods
SET published_at = data_verified_at,
    verification_method = 'legacy_human'
WHERE data_verified_at IS NOT NULL;

ALTER TABLE public.foods
  ADD CONSTRAINT foods_publication_state_valid CHECK (
    (
      published_at IS NULL
      AND verification_method IS NULL
      AND published_by IS NULL
    )
    OR
    (
      published_at IS NOT NULL
      AND data_verified_at IS NOT NULL
      AND verification_method IS NOT NULL
    )
  );

CREATE INDEX foods_published_idx
  ON public.foods (published_at)
  WHERE published_at IS NOT NULL;

CREATE INDEX foods_published_by_idx
  ON public.foods (published_by)
  WHERE published_by IS NOT NULL;

DROP POLICY IF EXISTS "public read foods" ON public.foods;

CREATE POLICY "public read foods"
  ON public.foods
  FOR SELECT
  TO anon, authenticated
  USING (published_at IS NOT NULL);

DROP POLICY IF EXISTS "owner manages logs" ON public.feeding_logs;

CREATE POLICY "owner manages logs"
  ON public.feeding_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cats AS cat
      WHERE cat.id = feeding_logs.cat_id
        AND cat.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cats AS cat
      WHERE cat.id = feeding_logs.cat_id
        AND cat.owner_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM public.foods AS food
      WHERE food.id = feeding_logs.food_id
        AND food.published_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.publish_food_draft(
  p_food_id bigint,
  p_actor_id uuid,
  p_expected_updated_at timestamptz,
  p_derived jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_food public.foods%ROWTYPE;
  v_nutrient_key text;
  v_food_value numeric;
  v_evidence_value numeric;
  v_published_at timestamptz;
BEGIN
  SELECT *
    INTO v_food
  FROM public.foods
  WHERE id = p_food_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_food.published_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_published');
  END IF;

  IF v_food.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'A human actor is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.food_nutrient_evidence AS evidence
    JOIN public.food_sources AS source ON source.id = evidence.source_id
    WHERE evidence.food_id = p_food_id
      AND evidence.is_current
      AND source.food_id = p_food_id
      AND source.is_current
      AND source.fetch_status = 'fetched'
  ) THEN
    RETURN jsonb_build_object('status', 'no_evidence');
  END IF;

  FOR v_nutrient_key IN
    SELECT unnest(ARRAY[
      'protein_pct',
      'fat_pct',
      'fiber_pct',
      'ash_pct',
      'moisture_pct',
      'calcium_pct',
      'phosphorus_pct',
      'kcal_per_kg'
    ]::text[])
  LOOP
    EXECUTE format(
      'SELECT %1$I FROM public.foods WHERE id = $1',
      v_nutrient_key
    )
    INTO v_food_value
    USING p_food_id;

    IF v_food_value IS NULL THEN
      CONTINUE;
    END IF;

    SELECT evidence.value
      INTO v_evidence_value
    FROM public.food_nutrient_evidence AS evidence
    JOIN public.food_sources AS source ON source.id = evidence.source_id
    WHERE evidence.food_id = p_food_id
      AND evidence.nutrient_key = v_nutrient_key
      AND evidence.is_current
      AND source.food_id = p_food_id
      AND source.is_current
      AND source.fetch_status = 'fetched';

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'status', 'missing_evidence',
        'nutrient_key', v_nutrient_key
      );
    END IF;

    IF v_evidence_value IS DISTINCT FROM v_food_value THEN
      RETURN jsonb_build_object(
        'status', 'evidence_mismatch',
        'nutrient_key', v_nutrient_key
      );
    END IF;
  END LOOP;

  IF p_derived IS NULL
    OR jsonb_typeof(p_derived) <> 'object'
    OR NOT (p_derived ? 'carbPct')
    OR NOT (p_derived ? 'carbIsEstimated')
    OR NOT (p_derived ? 'energyPPct')
    OR NOT (p_derived ? 'energyFPct')
    OR NOT (p_derived ? 'energyCPct')
    OR NOT (p_derived ? 'nutrientSources')
    OR jsonb_typeof(p_derived -> 'carbIsEstimated') <> 'boolean'
    OR jsonb_typeof(p_derived -> 'nutrientSources') <> 'object'
    OR coalesce(jsonb_typeof(p_derived -> 'carbPct'), '') NOT IN ('number', 'null')
    OR coalesce(jsonb_typeof(p_derived -> 'energyPPct'), '') NOT IN ('number', 'null')
    OR coalesce(jsonb_typeof(p_derived -> 'energyFPct'), '') NOT IN ('number', 'null')
    OR coalesce(jsonb_typeof(p_derived -> 'energyCPct'), '') NOT IN ('number', 'null') THEN
    RAISE EXCEPTION 'Derived publication payload is invalid';
  END IF;

  v_published_at := statement_timestamp();

  UPDATE public.foods
  SET carb_pct = (p_derived ->> 'carbPct')::numeric,
      carb_is_estimated = (p_derived ->> 'carbIsEstimated')::boolean,
      energy_p_pct = (p_derived ->> 'energyPPct')::numeric,
      energy_f_pct = (p_derived ->> 'energyFPct')::numeric,
      energy_c_pct = (p_derived ->> 'energyCPct')::numeric,
      nutrient_sources = p_derived -> 'nutrientSources',
      data_verified_at = v_published_at,
      published_at = v_published_at,
      published_by = p_actor_id,
      verification_method = 'human'
  WHERE id = p_food_id;

  RETURN jsonb_build_object(
    'status', 'published',
    'published_at', v_published_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_food_draft(bigint, uuid, timestamptz, jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.publish_food_draft(bigint, uuid, timestamptz, jsonb)
TO service_role;
