CREATE TABLE food_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  food_id bigint NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,
  kind public.nutrient_source NOT NULL CHECK (kind IN ('manufacturer', 'kr_label')),
  url text NOT NULL,
  capture_method text NOT NULL CHECK (capture_method IN ('fetch', 'manual')),
  fetch_status text NOT NULL CHECK (fetch_status IN ('fetched', 'failed')),
  failure_code text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  captured_at timestamptz,
  observed_at timestamptz,
  content_hash text,
  captured_text text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT food_sources_capture_state_check CHECK (
    (
      fetch_status = 'fetched'
      AND failure_code IS null
      AND captured_at IS NOT null
      AND content_hash IS NOT null
      AND captured_text IS NOT null
    )
    OR (
      fetch_status = 'failed'
      AND failure_code IS NOT null
      AND captured_at IS null
      AND content_hash IS null
      AND captured_text IS null
    )
  )
);

CREATE UNIQUE INDEX food_sources_current_fetched_kind_idx
  ON public.food_sources (food_id, kind)
  WHERE is_current AND fetch_status = 'fetched';

CREATE INDEX food_sources_food_attempted_idx
  ON public.food_sources (food_id, attempted_at DESC);

CREATE TABLE food_nutrient_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  food_id bigint NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,
  nutrient_key text NOT NULL CHECK (
    nutrient_key IN (
      'protein_pct',
      'fat_pct',
      'fiber_pct',
      'ash_pct',
      'moisture_pct',
      'calcium_pct',
      'phosphorus_pct',
      'kcal_per_kg'
    )
  ),
  source_id bigint NOT NULL REFERENCES public.food_sources(id) ON DELETE RESTRICT,
  value numeric NOT NULL,
  excerpt text NOT NULL CHECK (btrim(excerpt) <> ''),
  captured_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX food_nutrient_evidence_current_key_idx
  ON public.food_nutrient_evidence (food_id, nutrient_key)
  WHERE is_current;

CREATE INDEX food_nutrient_evidence_source_idx
  ON public.food_nutrient_evidence (source_id);

ALTER TABLE public.food_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_nutrient_evidence ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.apply_food_evidence_draft(
  p_food_id bigint,
  p_evidence jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_nutrient_key text;
  v_source_id bigint;
  v_value numeric;
  v_excerpt text;
  v_source_kind public.nutrient_source;
  v_captured_at timestamptz;
  v_captured_text text;
  v_rows_updated integer;
BEGIN
  IF p_evidence IS NULL
    OR jsonb_typeof(p_evidence) <> 'array'
    OR jsonb_array_length(p_evidence) = 0 THEN
    RAISE EXCEPTION 'Evidence must be a non-empty JSON array';
  END IF;

  PERFORM 1
  FROM public.foods
  WHERE id = p_food_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Food % does not exist', p_food_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_evidence) AS evidence(item)
    GROUP BY item ->> 'nutrient_key'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate nutrient keys are not allowed';
  END IF;

  FOR v_item IN
    SELECT item
    FROM jsonb_array_elements(p_evidence) AS evidence(item)
  LOOP
    IF coalesce(jsonb_typeof(v_item), '') <> 'object'
      OR NOT (v_item ? 'nutrient_key')
      OR NOT (v_item ? 'source_id')
      OR NOT (v_item ? 'value')
      OR NOT (v_item ? 'excerpt') THEN
      RAISE EXCEPTION 'Each evidence item requires nutrient_key, source_id, value, and excerpt';
    END IF;

    v_nutrient_key := v_item ->> 'nutrient_key';
    v_excerpt := btrim(v_item ->> 'excerpt');

    IF v_nutrient_key NOT IN (
      'protein_pct',
      'fat_pct',
      'fiber_pct',
      'ash_pct',
      'moisture_pct',
      'calcium_pct',
      'phosphorus_pct',
      'kcal_per_kg'
    ) THEN
      RAISE EXCEPTION 'Unsupported nutrient key: %', v_nutrient_key;
    END IF;

    IF jsonb_typeof(v_item -> 'source_id') <> 'number'
      OR jsonb_typeof(v_item -> 'value') <> 'number'
      OR v_excerpt = '' THEN
      RAISE EXCEPTION 'Evidence values must use numeric source_id and value with a non-empty excerpt';
    END IF;

    v_source_id := (v_item ->> 'source_id')::bigint;
    v_value := (v_item ->> 'value')::numeric;

    IF v_source_id::numeric <> (v_item ->> 'source_id')::numeric THEN
      RAISE EXCEPTION 'Evidence source_id must be an integer';
    END IF;

    IF v_value < 0 OR v_value IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) THEN
      RAISE EXCEPTION 'Evidence value must be finite and non-negative';
    END IF;

    SELECT kind, captured_at, captured_text
      INTO v_source_kind, v_captured_at, v_captured_text
    FROM public.food_sources
    WHERE id = v_source_id
      AND food_id = p_food_id
      AND is_current
      AND fetch_status = 'fetched'
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source % is not a current fetched source for food %', v_source_id, p_food_id;
    END IF;

    IF position(
      lower(regexp_replace(v_excerpt, E'\\s+', ' ', 'g'))
      IN lower(regexp_replace(v_captured_text, E'\\s+', ' ', 'g'))
    ) = 0 THEN
      RAISE EXCEPTION 'Evidence excerpt is absent from source %', v_source_id;
    END IF;

    EXECUTE format(
      'UPDATE public.foods
       SET %1$I = $1,
           nutrient_sources = coalesce(nutrient_sources, ''{}''::jsonb) || jsonb_build_object($2, $3),
           updated_at = statement_timestamp()
       WHERE id = $4
         AND %1$I IS NULL',
      v_nutrient_key
    )
    USING v_value, v_nutrient_key, v_source_kind::text, p_food_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated <> 1 THEN
      RAISE EXCEPTION 'Nutrient % is already populated for food %', v_nutrient_key, p_food_id;
    END IF;

    UPDATE public.food_nutrient_evidence
    SET is_current = false
    WHERE food_id = p_food_id
      AND nutrient_key = v_nutrient_key
      AND is_current;

    INSERT INTO public.food_nutrient_evidence (
      food_id,
      nutrient_key,
      source_id,
      value,
      excerpt,
      captured_at
    ) VALUES (
      p_food_id,
      v_nutrient_key,
      v_source_id,
      v_value,
      v_excerpt,
      v_captured_at
    );
  END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.food_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.food_nutrient_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_food_evidence_draft(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_food_evidence_draft(bigint, jsonb) TO service_role;
