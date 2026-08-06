-- 소유권 검사를 적용 시점까지 확장한다.
--
-- 20260806124500이 수집 시점에 클레임을 원자적으로 만들었지만, 근거 적용은 그
-- 다음 트랜잭션이다. 그 틈에 큐레이터가 *다른 kind*의 출처를 등록하면 이 실행의
-- 출처는 은퇴되지 않아 여전히 current이고, 브로커는 검사를 통과해 값을 쓴다.
-- 클레임을 잃은 실행이 조용히 DRAFT를 채우는 것을 여기서 막는다.
--
-- 거절은 결과 상태가 아니라 커스텀 SQLSTATE 'CFCLM'으로 알린다. 반환값은 근거
-- 항목별 배열이라 "전체 거절"을 담을 자리가 없고, 문자열 매칭보다 코드가 안전하다.

DROP FUNCTION public.apply_food_evidence_draft(bigint, jsonb);

CREATE FUNCTION public.apply_food_evidence_draft(
  p_food_id bigint,
  p_evidence jsonb,
  p_owned_source_ids bigint [] DEFAULT NULL
)
RETURNS jsonb
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
$$;

REVOKE ALL ON FUNCTION public.apply_food_evidence_draft(bigint, jsonb, bigint [])
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_food_evidence_draft(bigint, jsonb, bigint [])
TO service_role;
