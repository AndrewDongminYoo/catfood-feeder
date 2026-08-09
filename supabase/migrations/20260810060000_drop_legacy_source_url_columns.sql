-- 죽은 비정규화 컬럼 foods.manufacturer_url / kr_label_source 를 없앤다.
--
-- 두 컬럼은 쓰이기만 하고 아무도 읽지 않는다. 화면에도, 판단에도 쓰이지 않는다 —
-- 소비처는 타입 선언(src/lib/catalog.ts)과 생성 API 의 쓰기 한 줄뿐이었다.
--
-- 그리고 이미 오래전부터 틀려 있었다: manufacturer_url 은 368행 중 96행이,
-- kr_label_source 는 34행 중 28행이 그 사료의 현행 출처와 일치하지 않았다. 값이
-- 하나뿐인 컬럼에 여러 번 갱신되는 URL 을 담았으니 마지막 등록만 남는 구조였다.
--
-- 2026-08-10 의 제약 변경(20260810030000)으로 사료 하나가 제조사 페이지를 여럿
-- 가질 수 있게 되면서, 이 컬럼은 틀린 정도가 아니라 원리적으로 옳을 수 없게 됐다.
-- 일회성 UPDATE 로는 고칠 수 없다 — RPC 가 등록할 때마다 다시 단일 값으로 덮는다.
--
-- 출처는 food_sources 가 소유하고, 어느 값이 어느 출처에서 왔는지는
-- food_nutrient_evidence.source_id 가 소유한다. 이 컬럼들이 답하던 질문은 그 둘이
-- 이미 더 정확하게 답한다.

BEGIN;

-- 먼저 RPC 에서 두 컬럼을 쓰는 꼬리를 뗀다. plpgsql 본문은 의존성 추적이 안 되므로
-- 순서를 뒤집으면 드롭은 성공하고 다음 등록이 런타임에 죽는다.
CREATE OR REPLACE FUNCTION public.replace_current_food_source(
  p_food_id bigint,
  p_kind public.nutrient_source,
  p_url text,
  p_capture_method text,
  p_captured_at timestamptz,
  p_content_hash text,
  p_captured_text text,
  p_observed_at timestamptz DEFAULT null,
  p_created_by uuid DEFAULT null,
  p_owned_source_ids bigint [] DEFAULT null
)
RETURNS TABLE(source_id bigint, content_status text, claim_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_hash text;
  v_had_previous boolean;
  v_published_at timestamptz;
BEGIN
  IF p_kind NOT IN ('manufacturer', 'kr_label') THEN
    RAISE EXCEPTION 'Source kind % is not supported', p_kind;
  END IF;

  IF p_capture_method NOT IN ('fetch', 'manual') THEN
    RAISE EXCEPTION 'Capture method % is not supported', p_capture_method;
  END IF;

  IF p_url IS NULL
    OR btrim(p_url) = ''
    OR p_captured_at IS NULL
    OR p_content_hash IS NULL
    OR btrim(p_content_hash) = ''
    OR p_captured_text IS NULL
    OR btrim(p_captured_text) = '' THEN
    RAISE EXCEPTION 'Fetched source fields must be complete';
  END IF;

  SELECT published_at
  INTO v_published_at
  FROM public.foods
  WHERE id = p_food_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Food % does not exist', p_food_id;
  END IF;

  -- 잠금 안에서 판정한다. 여기서 통과하면 커밋까지 다른 writer가 끼어들 수 없다.
  IF p_owned_source_ids IS NOT NULL THEN
    IF v_published_at IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.food_sources
        WHERE food_id = p_food_id
          AND fetch_status = 'fetched'
          AND is_current
          AND NOT (id = ANY (p_owned_source_ids))
      ) THEN
      source_id := NULL;
      content_status := NULL;
      claim_status := 'conflict';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT content_hash
  INTO v_previous_hash
  FROM public.food_sources
  WHERE food_id = p_food_id
    AND url = p_url
    AND fetch_status = 'fetched'
    AND is_current;

  v_had_previous := FOUND;
  content_status := CASE
    WHEN NOT v_had_previous THEN 'initial'
    WHEN v_previous_hash = p_content_hash THEN 'unchanged'
    ELSE 'changed'
  END;
  claim_status := 'claimed';

  UPDATE public.food_sources
  SET is_current = false
  WHERE food_id = p_food_id
    AND url = p_url
    AND fetch_status = 'fetched'
    AND is_current;

  INSERT INTO public.food_sources (
    food_id,
    kind,
    url,
    capture_method,
    fetch_status,
    failure_code,
    captured_at,
    observed_at,
    content_hash,
    captured_text,
    created_by,
    is_current
  ) VALUES (
    p_food_id,
    p_kind,
    p_url,
    p_capture_method,
    'fetched',
    NULL,
    p_captured_at,
    p_observed_at,
    p_content_hash,
    p_captured_text,
    p_created_by,
    true
  )
  RETURNING id INTO source_id;

  RETURN NEXT;
END;
$$;

ALTER TABLE public.foods
  DROP COLUMN manufacturer_url,
  DROP COLUMN kr_label_source;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'foods'
      AND column_name IN ('manufacturer_url', 'kr_label_source')
  ) THEN
    RAISE EXCEPTION '컬럼이 남아 있다';
  END IF;

  -- 출처 등록 경로가 끊기지 않았는지. 함수가 사라지면 조사 파이프라인 전체가 멈춘다.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'replace_current_food_source'
  ) THEN
    RAISE EXCEPTION '교체 RPC 가 사라졌다';
  END IF;
END $verify$;

COMMIT;
