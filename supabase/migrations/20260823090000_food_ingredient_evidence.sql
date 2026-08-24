-- 원재료는 아홉 개 영양소 키와 같은 모양이 아니다. 값 하나가 아니라 목록 하나이고,
-- 충돌도 필드별이 아니라 목록 전체 단위다. apply_food_evidence_draft 에 열 번째
-- nutrient_key 로 밀어 넣으면 kind 를 슬롯으로 쓰는 것과 같은 실수가 된다
-- (20260810030000_source_kind_is_meaning_not_slot.sql 이 이미 한 번 바로잡았다).
-- 그래서 형제 함수를 두고, 지켜야 할 불변식만 그대로 따라 간다.
--
-- 이 함수의 검증 거절은 전부 SQLSTATE 'CFING' 을 단다. 호출자가 거절과 장애를
-- 문구로 가르면 목록이 하나 늘 때마다 분류가 조용히 낡는다 — 실제로 완전성 검사를
-- 추가하자마자 그 메시지가 목록에서 빠져 400 이어야 할 응답이 500 이 됐다.
-- 소유권 상실만 기존 규약대로 'CFCLM' 을 유지한다.

CREATE TABLE public.food_ingredient_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  food_id bigint NOT NULL REFERENCES public.foods (id) ON DELETE CASCADE,
  source_id bigint NOT NULL REFERENCES public.food_sources (id) ON DELETE RESTRICT,
  excerpt text NOT NULL CHECK (btrim(excerpt) <> ''),
  -- 이 목록을 적용한 주체. 대상은 이미 사람이 검증한 발행 행이고 그 검증 시각은
  -- 영양소로 얻은 것이므로, 원재료가 에이전트에서 왔다면 행이 그렇게 말해야 한다.
  -- 그러지 않으면 사람 검증 도장이 검증한 적 없는 데이터까지 덮는 것처럼 읽힌다.
  applied_by_origin text NOT NULL CHECK (applied_by_origin IN ('human', 'automation')),
  captured_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 현재 근거가 무엇인지 정의되게 만드는 인덱스. 영양소 쪽과 같은 모양이되,
-- 사료 하나에 목록이 하나이므로 nutrient_key 자리가 없다.
CREATE UNIQUE INDEX food_ingredient_evidence_current_idx
ON public.food_ingredient_evidence (food_id)
WHERE is_current;

CREATE INDEX food_ingredient_evidence_source_idx
ON public.food_ingredient_evidence (source_id);

ALTER TABLE public.food_ingredient_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.food_ingredient_evidence
FROM public, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.food_ingredient_evidence TO service_role;

COMMENT ON TABLE public.food_ingredient_evidence IS
'사료별 원재료 목록의 현재 근거. 목록은 사료당 하나이므로 nutrient_key 축이 없다.';

CREATE OR REPLACE FUNCTION public.apply_food_ingredients_draft(
  p_food_id bigint,
  p_source_id bigint,
  p_excerpt text,
  p_ingredients jsonb,
  p_applied_by_origin text,
  p_owned_source_ids bigint [] DEFAULT NULL::bigint []
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_excerpt text := btrim(p_excerpt);
  v_norm_excerpt text;
  v_source_kind public.nutrient_source;
  v_captured_at timestamptz;
  v_captured_text text;
  v_existing jsonb;
  v_existing_kind public.nutrient_source;
  v_item jsonb;
  v_index int := 0;
  v_name text;
  v_cursor int := 1;
  v_norm_name text;
  v_hit int;
  v_gap text;
  v_status text;
BEGIN
  IF p_ingredients IS NULL
    OR jsonb_typeof(p_ingredients) <> 'array'
    OR jsonb_array_length(p_ingredients) = 0 THEN
    RAISE EXCEPTION 'Ingredients must be a non-empty JSON array'
    USING ERRCODE = 'CFING';
  END IF;

  IF v_excerpt = '' THEN
    RAISE EXCEPTION 'Each ingredient draft requires a non-empty excerpt'
    USING ERRCODE = 'CFING';
  END IF;

  IF p_applied_by_origin IS NULL OR p_applied_by_origin NOT IN ('human', 'automation') THEN
    RAISE EXCEPTION 'Each ingredient draft requires a known applying origin'
    USING ERRCODE = 'CFING';
  END IF;

  -- 영양소 경로는 발행 전 draft 를 채우므로 data_verified_at IS NULL 을 요구한다.
  -- 이 채널은 반대다: 이미 발행된 행의 빈 원재료를 보강하는 것이 존재 이유이고,
  -- 발행된 125건은 전부 data_verified_at 이 채워져 있다. 그 가드를 그대로 가져오면
  -- 대상 전부를 거절한다. 여기서 값을 지키는 것은 검증 시각이 아니라 아래의
  -- "비어 있을 때만 쓴다" 규칙이므로, 잠금만 남기고 술어는 뺀다.
  -- 발행 상태와 검증 시각은 이 함수가 절대 건드리지 않는다.
  PERFORM 1
  FROM public.foods
  WHERE id = p_food_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Food % does not exist', p_food_id
    USING ERRCODE = 'CFING';
  END IF;

  -- 수집 시점에 잡은 소유권을 적용 시점에 다시 확인한다. 영양소 경로와 같은 이유다.
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

  SELECT kind, captured_at, captured_text
  INTO v_source_kind, v_captured_at, v_captured_text
  FROM public.food_sources
  WHERE id = p_source_id
    AND food_id = p_food_id
    AND is_current
    AND fetch_status = 'fetched'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source % is not a current fetched source for food %', p_source_id, p_food_id
    USING ERRCODE = 'CFING';
  END IF;

  v_norm_excerpt := lower(btrim(regexp_replace(normalize(v_excerpt, NFKC), E'\\s+', ' ', 'g')));

  IF position(
    v_norm_excerpt
    IN lower(btrim(regexp_replace(normalize(v_captured_text, NFKC), E'\\s+', ' ', 'g')))
  ) = 0 THEN
    RAISE EXCEPTION 'Evidence excerpt is absent from source %', p_source_id
    USING ERRCODE = 'CFING';
  END IF;

  FOR v_item IN
    SELECT item
    FROM jsonb_array_elements(p_ingredients) AS ingredient (item)
    LOOP
      v_index := v_index + 1;

      IF coalesce(jsonb_typeof(v_item), '') <> 'object'
        OR NOT (v_item ? 'name')
        OR NOT (v_item ? 'position') THEN
        RAISE EXCEPTION 'Each ingredient requires name and position'
        USING ERRCODE = 'CFING';
      END IF;

      v_name := btrim(v_item ->> 'name');

      IF v_name = '' THEN
        RAISE EXCEPTION 'Ingredient name must not be empty'
        USING ERRCODE = 'CFING';
      END IF;

      -- 순서가 이 데이터의 값이다. 배열 순서와 position 이 어긋나면 조용히 잘못
      -- 정렬된 목록이 발행되므로, 1..n 연속만 받는다.
      IF jsonb_typeof(v_item -> 'position') <> 'number'
        OR (v_item ->> 'position')::numeric <> v_index THEN
        RAISE EXCEPTION 'Ingredient positions must be 1..n in array order'
        USING ERRCODE = 'CFING';
      END IF;

      -- 구절은 라벨이 쓴 그대로이므로, 이름들이 구절을 빈틈없이 덮어야 한다.
      -- 이름 사이에는 진짜 구분자가 하나 있어야 하고 공백은 구분자가 아니다 —
      -- 공백을 구분자로 치면 "chicken meal" 한 항목이 "chicken" 과 "meal" 두
      -- 항목으로 저장된다. 이 검사 하나가 뒤섞인 순서, 낱말 중간에 걸린 부분 일치,
      -- 여러 낱말 이름의 분해, 잘린 목록을 함께 막는다.
      v_norm_name := lower(btrim(regexp_replace(normalize(v_name, NFKC), E'\\s+', ' ', 'g')));

      v_hit := position(v_norm_name IN substr(v_norm_excerpt, v_cursor));

      IF v_hit = 0 THEN
        RAISE EXCEPTION 'Ingredient name % does not continue the excerpt at its declared position', v_name
        USING ERRCODE = 'CFING';
      END IF;

      -- 유효한 간격이 아니라면 더 뒤의 등장도 유효할 수 없다. 간격은 길어질 뿐이고,
      -- 짧은 간격이 이미 담고 있던 구분자 아닌 글자를 계속 담기 때문이다.
      v_gap := substr(v_norm_excerpt, v_cursor, v_hit - 1);

      IF NOT (CASE
        WHEN v_index = 1 THEN v_gap ~ '^[[:space:]]*$'
        ELSE v_gap ~ '^[[:space:]]*[,;][[:space:]]*$'
      END) THEN
        RAISE EXCEPTION 'Ingredient name % does not continue the excerpt at its declared position', v_name
        USING ERRCODE = 'CFING';
      END IF;

      v_cursor := v_cursor + v_hit - 1 + length(v_norm_name);
    END LOOP;

  -- 마지막 항목 뒤에 구분자나 마침표 말고 무엇이 남아 있으면 목록이 잘린 것이다.
  IF substr(v_norm_excerpt, v_cursor) !~ '^[[:space:]]*[.,;]?[[:space:]]*$' THEN
    RAISE EXCEPTION 'Ingredient list does not cover the whole excerpt'
    USING ERRCODE = 'CFING';
  END IF;

  SELECT ingredients INTO v_existing FROM public.foods WHERE id = p_food_id;

  SELECT source.kind INTO v_existing_kind
  FROM public.food_ingredient_evidence AS evidence
  INNER JOIN public.food_sources AS source ON evidence.source_id = source.id
  WHERE evidence.food_id = p_food_id
    AND evidence.is_current;

  IF v_existing IS NULL OR jsonb_array_length(v_existing) = 0 THEN
    UPDATE public.foods
    SET ingredients = p_ingredients,
      updated_at = statement_timestamp()
    WHERE id = p_food_id;
    v_status := 'applied';
  ELSIF v_existing_kind IS DISTINCT FROM v_source_kind THEN
    -- 출처 종류가 다르면 기존 값과 provenance 를 지킨다. 영양소 경로와 같다.
    v_status := 'skipped';
  ELSIF v_existing = p_ingredients THEN
    -- 값이 같으면 근거만 새 capture 로 교체한다.
    v_status := 'applied';
  ELSE
    v_status := 'conflict';
  END IF;

  IF v_status = 'applied' THEN
    UPDATE public.food_ingredient_evidence
    SET is_current = false
    WHERE food_id = p_food_id
      AND is_current;

    INSERT INTO public.food_ingredient_evidence (
      food_id,
      source_id,
      excerpt,
      applied_by_origin,
      captured_at
    ) VALUES (
      p_food_id,
      p_source_id,
      v_excerpt,
      p_applied_by_origin,
      v_captured_at
    );
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'count', jsonb_array_length(p_ingredients)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_food_ingredients_draft(bigint, bigint, text, jsonb, text, bigint [])
FROM public, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.apply_food_ingredients_draft(bigint, bigint, text, jsonb, text, bigint [])
TO service_role;

COMMENT ON FUNCTION public.apply_food_ingredients_draft(bigint, bigint, text, jsonb, text, bigint []) IS
'보관된 캡처가 증명하는 원재료 목록만 사료에 적용한다. 기존 목록은 덮어쓰지 않는다.';
