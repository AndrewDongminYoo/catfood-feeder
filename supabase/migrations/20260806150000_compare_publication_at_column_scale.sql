-- 발행 비교를 컬럼 스케일에 맞춘다.
--
-- 근거 값과 저장 값을 정밀도 그대로 비교하면, 소수점 3자리를 표기한 라벨에서
-- 사료가 영구히 발행 불가가 된다. 재적용으로도 빠져나올 수 없다.

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

    -- foods.<nutrient> 는 numeric(_,2) 라 저장 시 반올림되지만 근거 원장의 value 는
    -- 무제약 numeric 이라 원문 그대로 남는다. 그대로 비교하면 소수점 3자리 라벨
    -- (예: 인 0.895%) 이 영구히 evidence_mismatch 가 되고, 같은 근거를 다시
    -- 적용해도 "값이 같음" 분기로 빠져 수렴하지 않아 그 사료는 발행 불가로 잠긴다.
    -- 컬럼 스케일에 맞춰 비교한다 — round(v,2) 는 numeric(_,2) 캐스트와 동일하다.
    IF round(v_evidence_value, 2) IS DISTINCT FROM v_food_value THEN
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
