-- 조사 경로가 큐레이터의 출처를 밀어내지 못하게 교체 트랜잭션 안에서 다시 확인한다.
--
-- broker는 대상이 skeleton인지 먼저 확인하지만, 그 확인과 이 교체 사이에는 외부
-- HTTP 수집이 끼어 있어 창이 넓다. 그 사이에 다른 조사 실행이 통과하거나 큐레이터가
-- 출처를 등록·발행하면, 이 함수는 아무 확인 없이 current 출처를 은퇴시켜 버린다.
-- 그래서 foods 행을 잠근 직후, 잠금 안에서 조건을 다시 본다.
--
-- 판별식: `created_by IS NOT NULL`인 current fetched 출처가 있으면 사람이 잡은
-- 것으로 본다. 이는 추론이 아니라 라우트가 강제하는 사실이다 —
-- `/api/foods/[id]/sources`는 automation 자격 증명을 거부하므로 큐레이터 수집은
-- 항상 세션 uuid를 남기고, research broker는 언제나 NULL을 넘긴다. 이 두 방향은
-- `supabase/tests/research_claim_guard_test.sql`에서 함께 검증한다.
--
-- 조사 실행이 자기가 방금 넣은 출처(created_by NULL) 위에 두 번째 kind를 얹는 것은
-- 정상 흐름이므로 막지 않는다.

-- 대상을 뺏긴 실행은 수집 실패와 다른 사건이므로 원장에서도 구분한다.
ALTER TABLE public.food_research_runs
  DROP CONSTRAINT food_research_runs_status_check;

ALTER TABLE public.food_research_runs
  ADD CONSTRAINT food_research_runs_status_check
  CHECK (status IN ('applied', 'rejected', 'capture_failed', 'claim_conflict'));

DROP FUNCTION public.replace_current_food_source(
  bigint,
  public.nutrient_source,
  text,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  uuid
);

CREATE FUNCTION public.replace_current_food_source(
  p_food_id bigint,
  p_kind public.nutrient_source,
  p_url text,
  p_capture_method text,
  p_captured_at timestamptz,
  p_content_hash text,
  p_captured_text text,
  p_observed_at timestamptz DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_require_unclaimed boolean DEFAULT FALSE
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
  IF p_require_unclaimed THEN
    IF v_published_at IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM public.food_sources
        WHERE food_id = p_food_id
          AND fetch_status = 'fetched'
          AND is_current
          AND created_by IS NOT NULL
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
    AND kind = p_kind
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
    AND kind = p_kind
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

  IF p_kind = 'manufacturer' THEN
    UPDATE public.foods
    SET manufacturer_url = p_url
    WHERE id = p_food_id;
  ELSE
    UPDATE public.foods
    SET kr_label_source = p_url
    WHERE id = p_food_id;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_current_food_source(
  bigint,
  public.nutrient_source,
  text,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  uuid,
  boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.replace_current_food_source(
  bigint,
  public.nutrient_source,
  text,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  uuid,
  boolean
) TO service_role;
