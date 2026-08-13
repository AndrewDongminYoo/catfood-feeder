-- 라벨이 직접 쓴 탄수화물(NFE)에 근거를 붙일 수 있게 한다.
--
-- 한국 등록성분량은 수분을 쓰지 않는 대신 NFE를 직접 쓴다
-- ("단백질 33%, 지방 22%, 조섬유 1.6%, 조회분 7.4%, NFE 30.5%").
-- 그 형식에서 탄수화물은 계산값이 아니라 실측값인데 `carb_pct`가 근거 키가 아니어서,
-- 파이프라인이 실측값을 버리고 "수분이 없어 계산 불가"로 처리하고 있었다.
--
-- 발행 RPC의 근거 검사 루프에는 넣지 않는다. 그 루프는 "값이 있으면 근거가 있어야
-- 한다"인데 `carb_pct`는 역산으로 채워지는 것이 정상인 컬럼이라, 넣으면 기존 발행이
-- 전부 missing_evidence로 막힌다. 실측 carb의 근거는 적용 시점에 문자 그대로
-- 검증되고, 실측/계산 구분은 `nutrient_sources.carb_pct` 태그가 들고 있다.
--
-- 본문은 운영 중인 정의를 그대로 가져와 허용 키 한 줄만 더한 것이다. 손으로 옮겨
-- 적으면 빈 배열 검사·중복 키 검사·CFCLM 클레임 처리 같은 가드가 조용히 빠진다.

CREATE OR REPLACE FUNCTION public.apply_food_evidence_draft(p_food_id bigint, p_evidence jsonb, p_owned_source_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item jsonb;
  v_nutrient_key text;
  v_source_id bigint;
  v_value numeric;
  v_excerpt text;
  v_source_kind public.nutrient_source;
  v_captured_at timestamptz;
  v_captured_text text;
  v_existing_value numeric;
  v_existing_source_kind public.nutrient_source;
  v_existing_evidence_value numeric;
  v_status text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_evidence IS NULL
    OR jsonb_typeof(p_evidence) <> 'array'
    OR jsonb_array_length(p_evidence) = 0 THEN
    RAISE EXCEPTION 'Evidence must be a non-empty JSON array';
  END IF;

  PERFORM 1
  FROM public.foods
  WHERE id = p_food_id
    AND data_verified_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Food % does not exist or is already human-verified', p_food_id;
  END IF;

  -- 조사 경로는 수집 시점에 잡은 소유권을 적용 시점에도 다시 확인한다. 수집과
  -- 적용은 별개의 트랜잭션이라, 그 사이 큐레이터가 다른 kind의 출처를 붙이면
  -- 이 실행의 출처는 은퇴되지 않은 채 남아 검사를 통과해 버린다. 그러면 방금
  -- 사람이 가져간 사료에 값을 쓰게 되고, 이 함수는 비어 있는 필드만 채우므로
  -- 먼저 쓴 쪽이 영구히 이겨 큐레이터의 측정값이 조용히 버려진다.
  IF p_owned_source_ids IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.food_sources
    WHERE food_id = p_food_id
      AND fetch_status = 'fetched'
      AND is_current
      AND NOT (id = ANY (p_owned_source_ids))
  ) THEN
    RAISE EXCEPTION 'Research claim lost for food %', p_food_id
      USING ERRCODE = 'CFCLM';
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
      'kcal_per_kg',
      'carb_pct'
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
      lower(btrim(regexp_replace(normalize(v_excerpt, NFKC), E'\\s+', ' ', 'g')))
      IN lower(btrim(regexp_replace(normalize(v_captured_text, NFKC), E'\\s+', ' ', 'g')))
    ) = 0 THEN
      RAISE EXCEPTION 'Evidence excerpt is absent from source %', v_source_id;
    END IF;

    IF position('⁄' IN normalize(v_excerpt, NFKC)) > 0
      OR NOT (
      SELECT count(*) = 1
        AND bool_and(
          CASE
            WHEN evidence_number[1] ~ '^-?([0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?|[0-9]+(\.[0-9]+)?|\.[0-9]+)$'
              AND NOT (
                evidence_number[1] LIKE '.%'
                AND substring(
                  replace(normalize(v_excerpt, NFKC), '−', '-'),
                  position(evidence_number[1] IN replace(normalize(v_excerpt, NFKC), '−', '-')) - 1,
                  1
                ) ~ '[[:alnum:]]'
              )
            THEN abs(replace(evidence_number[1], ',', '')::numeric) <= 9007199254740991
              AND replace(evidence_number[1], ',', '')::numeric = v_value
            ELSE false
          END
        )
      FROM regexp_matches(
        replace(normalize(v_excerpt, NFKC), '−', '-'),
        '(-?([0-9][0-9.,]*|[,.]+[0-9][0-9.,]*))',
        'g'
      ) AS evidence_number
    ) THEN
      RAISE EXCEPTION 'Evidence value is absent from its excerpt';
    END IF;

    EXECUTE format(
      'SELECT %1$I FROM public.foods WHERE id = $1',
      v_nutrient_key
    )
    INTO v_existing_value
    USING p_food_id;

    v_existing_source_kind := NULL;
    v_existing_evidence_value := NULL;
    SELECT source.kind, evidence.value
      INTO v_existing_source_kind, v_existing_evidence_value
    FROM public.food_nutrient_evidence AS evidence
    JOIN public.food_sources AS source ON source.id = evidence.source_id
    WHERE evidence.food_id = p_food_id
      AND evidence.nutrient_key = v_nutrient_key
      AND evidence.is_current;

    IF v_existing_value IS NULL THEN
      EXECUTE format(
        'UPDATE public.foods
         SET %1$I = $1,
             nutrient_sources = coalesce(nutrient_sources, ''{}''::jsonb) || jsonb_build_object($2, $3),
             updated_at = statement_timestamp()
         WHERE id = $4',
        v_nutrient_key
      )
      USING v_value, v_nutrient_key, v_source_kind::text, p_food_id;
      v_status := 'applied';
    ELSIF v_existing_source_kind IS DISTINCT FROM v_source_kind THEN
      v_status := 'skipped';
    ELSIF v_existing_evidence_value IS DISTINCT FROM v_value THEN
      v_status := 'conflict';
    ELSE
      v_status := 'applied';
    END IF;

    IF v_status = 'applied' THEN
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
    END IF;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'nutrient_key', v_nutrient_key,
      'source_id', v_source_id,
      'value', v_value,
      'excerpt', v_excerpt,
      'status', v_status
    ));
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.foods
    WHERE id = p_food_id
      AND (
        coalesce(protein_pct, 0)
          + coalesce(fat_pct, 0)
          + coalesce(fiber_pct, 0)
          + coalesce(ash_pct, 0)
          + coalesce(moisture_pct, 0) > 100.000000001
        OR (kcal_per_kg IS NOT NULL AND kcal_per_kg NOT BETWEEN 500 AND 8000)
      )
  ) THEN
    RAISE EXCEPTION 'Evidence values violate catalog domain rules';
  END IF;

  RETURN v_result;
END;
$function$;

-- 근거 테이블의 키 목록도 같이 넓힌다. RPC 허용 목록만 고치면 INSERT가 제약에서
-- 막혀 적용 전체가 500으로 끝난다.
ALTER TABLE public.food_nutrient_evidence
  DROP CONSTRAINT food_nutrient_evidence_nutrient_key_check;

ALTER TABLE public.food_nutrient_evidence
  ADD CONSTRAINT food_nutrient_evidence_nutrient_key_check
  CHECK (nutrient_key = ANY (ARRAY[
    'protein_pct',
    'fat_pct',
    'fiber_pct',
    'ash_pct',
    'moisture_pct',
    'calcium_pct',
    'phosphorus_pct',
    'kcal_per_kg',
    'carb_pct'
  ]::text[]));
