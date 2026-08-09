-- 유럽 라벨의 소수점 쉼표를 근거 검증이 읽도록 한다.
--
-- 증상: "Crude Fibre 2,5 %" 같은 구절이 전부 거절됐다. 쉼표를 천 단위 구분자로만
-- 읽었기 때문이다. 이탈리아·독일·스페인 브랜드(몬지, 플래티넘, 닥터클라우더스,
-- 프로네이처, 알모네이쳐, 요시캣, 나투라디에트)의 라벨이 전부 이 표기라, 조사가
-- 옳은 페이지를 찾아 옳은 숫자를 인용해도 서버가 거부했다. 그 거절이 "이미지
-- 라벨이라 도달 불가"로 기록돼 재시도 대상에서 빠져 있었다.
--
-- 왜 모호하지 않은가: 천 단위 묶음은 쉼표 뒤가 정확히 3자리다. 쉼표 뒤가 1~2자리면
-- 묶음일 수 없으므로 소수점 외의 해석이 없다. "1,500"은 3자리라 계속 천 단위로 읽고,
-- "2,5"는 소수점으로 읽는다 — 두 모양은 겹치지 않는다.
--
-- 지우기와 바꾸기는 정반대 값을 낸다: '2,5'에서 쉼표를 지우면 25다. 섬유 25%는
-- validate 의 error 플래그에도 걸리지 않아 실측으로 발행된다. 그래서 모양에 따라
-- 갈라 쓰는 헬퍼를 두고, 두 곳에서 같은 것을 쓴다.

CREATE OR REPLACE FUNCTION public.excerpt_token_numeric(token text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 STRICT
 SET search_path TO ''
AS $$
  SELECT (CASE
    WHEN token ~ '^-?[0-9]+,[0-9]{1,2}$' THEN replace(token, ',', '.')
    ELSE replace(token, ',', '')
  END)::numeric;
$$;

COMMENT ON FUNCTION public.excerpt_token_numeric(text) IS
  '구절에서 뽑은 숫자 토큰을 numeric 으로. 쉼표 뒤 1~2자리는 소수점, 3자리는 천 단위.';

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
            WHEN evidence_number[1] ~ '^-?([0-9]+,[0-9]{1,2}|[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?|[0-9]+(\.[0-9]+)?|\.[0-9]+)$'
              AND NOT (
                evidence_number[1] LIKE '.%'
                AND substring(
                  replace(normalize(v_excerpt, NFKC), '−', '-'),
                  position(evidence_number[1] IN replace(normalize(v_excerpt, NFKC), '−', '-')) - 1,
                  1
                ) ~ '[[:alnum:]]'
              )
            THEN abs(public.excerpt_token_numeric(evidence_number[1])) <= 9007199254740991
              AND public.excerpt_token_numeric(evidence_number[1]) = v_value
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
$function$
