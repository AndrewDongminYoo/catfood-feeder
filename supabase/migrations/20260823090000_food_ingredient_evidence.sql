-- 원재료는 아홉 개 영양소 키와 같은 모양이 아니다. 값 하나가 아니라 목록 하나이고,
-- 충돌도 필드별이 아니라 목록 전체 단위다. apply_food_evidence_draft 에 열 번째
-- nutrient_key 로 밀어 넣으면 kind 를 슬롯으로 쓰는 것과 같은 실수가 된다
-- (20260810030000_source_kind_is_meaning_not_slot.sql 이 이미 한 번 바로잡았다).
-- 그래서 형제 함수를 두고, 지켜야 할 불변식만 그대로 따라 간다.

CREATE TABLE public.food_ingredient_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  food_id bigint NOT NULL REFERENCES public.foods (id) ON DELETE CASCADE,
  source_id bigint NOT NULL REFERENCES public.food_sources (id) ON DELETE RESTRICT,
  excerpt text NOT NULL CHECK (btrim(excerpt) <> ''),
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

-- 정규화된 haystack 에서 needle 이 from_pos 이후 처음 나타나는 1-기반 위치.
-- 앞뒤가 글자나 숫자면 낱말 중간에 걸린 것이므로 건너뛴다 — 그러지 않으면 "pea" 가
-- "peas" 안에서 잡혀 뒤에 오는 진짜 "pea flour" 를 가린다. 없으면 0.
--
-- 경계 판정에 [a-z0-9] 를 쓰면 안 된다. 한글은 그 클래스에 들지 않아 모든 음절이
-- 경계로 읽히고, 모델이 "닭고기"를 "닭"으로 잘라 답해도 근거가 증명한 값으로
-- 저장된다. [[:alnum:]] 는 UTF-8 데이터베이스에서 한글을 글자로 보고 쉼표와
-- 공백은 보지 않으므로, 두 언어에 같은 규칙이 걸린다.
CREATE OR REPLACE FUNCTION public.ordered_excerpt_offset(
  haystack text,
  needle text,
  from_pos int
)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO ''
AS $function$
DECLARE
  v_at int := from_pos;
  v_hit int;
BEGIN
  IF needle = '' THEN
    RETURN 0;
  END IF;

  LOOP
    v_hit := position(needle IN substr(haystack, v_at));
    IF v_hit = 0 THEN
      RETURN 0;
    END IF;

    v_hit := v_at + v_hit - 1;

    IF NOT (
      (v_hit > 1 AND substr(haystack, v_hit - 1, 1) ~ '[[:alnum:]]')
      OR substr(haystack, v_hit + length(needle), 1) ~ '[[:alnum:]]'
    ) THEN
      RETURN v_hit;
    END IF;

    v_at := v_hit + 1;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.ordered_excerpt_offset(text, text, int) IS
'정규화된 구절에서 낱말 경계를 지키는 첫 등장 위치. 순서 검사를 위해 커서와 함께 쓴다.';

CREATE OR REPLACE FUNCTION public.apply_food_ingredients_draft(
  p_food_id bigint,
  p_source_id bigint,
  p_excerpt text,
  p_ingredients jsonb,
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
  v_offset int;
  v_status text;
BEGIN
  IF p_ingredients IS NULL
    OR jsonb_typeof(p_ingredients) <> 'array'
    OR jsonb_array_length(p_ingredients) = 0 THEN
    RAISE EXCEPTION 'Ingredients must be a non-empty JSON array';
  END IF;

  IF v_excerpt = '' THEN
    RAISE EXCEPTION 'Each ingredient draft requires a non-empty excerpt';
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
    RAISE EXCEPTION 'Food % does not exist', p_food_id;
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
    RAISE EXCEPTION 'Source % is not a current fetched source for food %', p_source_id, p_food_id;
  END IF;

  v_norm_excerpt := lower(btrim(regexp_replace(normalize(v_excerpt, NFKC), E'\\s+', ' ', 'g')));

  IF position(
    v_norm_excerpt
    IN lower(btrim(regexp_replace(normalize(v_captured_text, NFKC), E'\\s+', ' ', 'g')))
  ) = 0 THEN
    RAISE EXCEPTION 'Evidence excerpt is absent from source %', p_source_id;
  END IF;

  FOR v_item IN
    SELECT item
    FROM jsonb_array_elements(p_ingredients) AS ingredient (item)
    LOOP
      v_index := v_index + 1;

      IF coalesce(jsonb_typeof(v_item), '') <> 'object'
        OR NOT (v_item ? 'name')
        OR NOT (v_item ? 'position') THEN
        RAISE EXCEPTION 'Each ingredient requires name and position';
      END IF;

      v_name := btrim(v_item ->> 'name');

      IF v_name = '' THEN
        RAISE EXCEPTION 'Ingredient name must not be empty';
      END IF;

      -- 순서가 이 데이터의 값이다. 배열 순서와 position 이 어긋나면 조용히 잘못
      -- 정렬된 목록이 발행되므로, 1..n 연속만 받는다.
      IF jsonb_typeof(v_item -> 'position') <> 'number'
        OR (v_item ->> 'position')::numeric <> v_index THEN
        RAISE EXCEPTION 'Ingredient positions must be 1..n in array order';
      END IF;

      -- 구절은 라벨이 쓴 그대로이므로 구절 안의 순서가 곧 기재 순서다. 이름이
      -- 어딘가에 있기만 하면 통과시키면, 모델이 뒤섞어 답해도 그대로 저장된다 —
      -- 순서가 이 데이터의 값인데 그것을 검사하지 않는 셈이다. 그래서 커서를
      -- 앞으로만 옮기며 순서대로 찾는다.
      v_offset := public.ordered_excerpt_offset(
        v_norm_excerpt,
        lower(btrim(regexp_replace(normalize(v_name, NFKC), E'\\s+', ' ', 'g'))),
        v_cursor
      );

      IF v_offset = 0 THEN
        RAISE EXCEPTION 'Ingredient name % is absent from its excerpt in declared order', v_name;
      END IF;

      v_cursor := v_offset
        + length(lower(btrim(regexp_replace(normalize(v_name, NFKC), E'\\s+', ' ', 'g'))));
    END LOOP;

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
      captured_at
    ) VALUES (
      p_food_id,
      p_source_id,
      v_excerpt,
      v_captured_at
    );
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'count', jsonb_array_length(p_ingredients)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_food_ingredients_draft(bigint, bigint, text, jsonb, bigint [])
FROM public, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.apply_food_ingredients_draft(bigint, bigint, text, jsonb, bigint [])
TO service_role;

COMMENT ON FUNCTION public.apply_food_ingredients_draft(bigint, bigint, text, jsonb, bigint []) IS
'보관된 캡처가 증명하는 원재료 목록만 사료에 적용한다. 기존 목록은 덮어쓰지 않는다.';
