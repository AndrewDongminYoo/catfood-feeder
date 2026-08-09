-- 출처의 "종류"를 자리가 아니라 뜻으로 되돌린다.
--
-- 문제: UNIQUE (food_id, kind) WHERE is_current AND fetched 때문에 사료당 종류별
-- 현행 출처가 하나뿐이었다. 그래서 두 번째 제조사 페이지를 붙일 자리가 없었고,
-- 조사 스크립트가 태그를 kr_label 로 뒤집어 빈 자리에 밀어 넣었다. 그 결과 영문
-- 제조사 페이지가 "국내라벨"로 등록됐고, /foods/[id] 는 그 태그를 값마다 독자에게
-- 그대로 표시한다. kr_label 은 한국 등록성분량이라는 규제 문서를 가리키는 뜻이지
-- 두 번째 슬롯이 아니다.
--
-- 조치는 셋이다.
--
--  A. 같은 URL 을 두 종류로 등록한 7쌍을 정리한다. kr_label 쪽은 같은 페이지를
--     한 번 더 캡처해 값 하나를 더 넣으려고 만든 중복이다(각 근거 1개). 근거를
--     manufacturer 출처로 옮기고 중복을 은퇴시킨다 — content_hash 가 같으므로
--     옮긴 구절은 그대로 검증된다.
--  B. 근거를 하나도 받치지 않는 오분류 4건(shop.purina, purina.ca)은 은퇴시킨다.
--  C. 나머지 오분류를 manufacturer 로 되돌리고, 그 출처가 받치는 값의
--     nutrient_sources 태그도 함께 고친다. 이걸 하려면 위 인덱스를 먼저 없애야
--     한다 — 되돌리는 순간 사료 하나에 manufacturer 현행이 둘이 되기 때문이다.
--
-- 무엇으로 가르는가: 호스트가 아니라 본문의 한글이다. 한국 등록성분량은 한글로
-- 쓰인다. reflexkorea.com 은 .kr 도 아니고 /kr 경로도 없지만 진짜 한국 수입사이고,
-- royalcanin.com 은 같은 호스트에 /kr 과 /us 가 함께 있다. 31건 전부에 대해
-- captured_text ~ '[가-힣]' 이 정확히 갈랐다(royalcanin 17건 중 /kr 4건만 통과).
--
-- 새 제약: UNIQUE (food_id, url). 원래 지키려던 것은 "같은 페이지의 캡처가 현행으로
-- 여럿 쌓이지 않는다"였고, 그것은 종류가 아니라 URL 의 성질이다. 재수집이 같은 URL 의
-- 이전 캡처를 교체하는 동작도 그대로 유지된다.
--
-- 적용 결과: 중복 7쌍 정리, 근거 없는 오분류 4건 은퇴, 14건 재태깅, 값 태그 21개 수정.
-- 적용한 뒤 sqlfluff 지적을 반영해 줄바꿈·대소문자·noqa 주석만 고쳤다(RPC 시그니처의
-- DEFAULT NULL 포함 — 키워드라 의미는 같다). 로직은 적용 당시와 같다.

BEGIN;

-- ── 사전 확인 ────────────────────────────────────────────────────────────────
DO $guard$
DECLARE bad int;
BEGIN
  -- A 의 전제: 같은 URL 쌍은 content_hash 가 같아야 근거를 옮겨도 검증이 성립한다.
  SELECT count(*) INTO bad
  FROM public.food_sources a
  JOIN public.food_sources b
    ON b.food_id = a.food_id AND b.url = a.url AND b.id <> a.id
   AND b.is_current AND b.fetch_status = 'fetched'
  WHERE a.is_current AND a.fetch_status = 'fetched'
    AND a.content_hash IS DISTINCT FROM b.content_hash;
  IF bad <> 0 THEN
    RAISE EXCEPTION '같은 URL 인데 캡처 내용이 다른 쌍 %건 — 근거를 옮길 수 없다', bad;
  END IF;
END $guard$;

-- ── A. 같은 URL 중복 정리 ────────────────────────────────────────────────────
CREATE TEMP TABLE url_dupe AS
SELECT
  dup.id AS drop_id,
  keep.id AS keep_id
FROM public.food_sources dup
JOIN public.food_sources keep
  ON keep.food_id = dup.food_id
 AND keep.url = dup.url
 AND keep.kind = 'manufacturer'
 AND keep.is_current
 AND keep.fetch_status = 'fetched'
WHERE dup.kind = 'kr_label'
  AND dup.is_current
  AND dup.fetch_status = 'fetched';

-- 옮겨올 키를 생존 출처가 이미 현행으로 들고 있으면 옮기는 쪽을 내린다.
-- UNIQUE (food_id, nutrient_key) WHERE is_current 때문이다.
UPDATE public.food_nutrient_evidence e
SET is_current = false
FROM url_dupe d
WHERE e.source_id = d.drop_id
  AND e.is_current
  AND EXISTS (
    SELECT 1 FROM public.food_nutrient_evidence sv
    WHERE sv.food_id = e.food_id
      AND sv.nutrient_key = e.nutrient_key
      AND sv.is_current
      AND sv.source_id = d.keep_id  -- noqa: RF01
  );

UPDATE public.food_nutrient_evidence e
SET source_id = d.keep_id
FROM url_dupe d
WHERE e.source_id = d.drop_id;

UPDATE public.food_sources s
SET is_current = false
FROM url_dupe d
WHERE s.id = d.drop_id;

-- ── B. 근거를 받치지 않는 오분류는 은퇴 ──────────────────────────────────────
UPDATE public.food_sources s
SET is_current = false
WHERE s.kind = 'kr_label'
  AND s.is_current
  AND s.fetch_status = 'fetched'
  AND s.captured_text !~ '[가-힣]'
  AND NOT EXISTS (
    SELECT 1 FROM public.food_nutrient_evidence e
    WHERE e.source_id = s.id AND e.is_current
  );

-- ── C. 인덱스를 먼저 없애고, 나머지 오분류를 manufacturer 로 되돌린다 ────────
DROP INDEX IF EXISTS public.food_sources_current_fetched_kind_idx;

CREATE TEMP TABLE retagged AS
SELECT s.id
FROM public.food_sources s
WHERE s.kind = 'kr_label'
  AND s.is_current
  AND s.fetch_status = 'fetched'
  AND s.captured_text !~ '[가-힣]';

UPDATE public.food_sources
SET kind = 'manufacturer'
WHERE id IN (SELECT id FROM retagged);

-- ── 값의 출처 태그를 받치는 출처와 맞춘다 ────────────────────────────────────
-- 이걸 빼면 카탈로그는 계속 "국내라벨"이라고 쓴다. 대상은 C 의 재태깅뿐이 아니다 —
-- A 에서 근거를 다른 출처로 옮긴 7건도 태그가 옛 종류에 남아 있다. 그래서 특정
-- 집합이 아니라 "태그가 받치는 출처와 어긋난 값" 전체를 맞춘다. 실측 태그
-- (manufacturer/kr_label)만 건드리고 derived/estimated 는 그대로 둔다 — 그쪽은
-- 출처가 아니라 계산의 산물이다.
UPDATE public.foods f
SET nutrient_sources = f.nutrient_sources || x.patch,
    updated_at = statement_timestamp()
FROM (
  SELECT
    e.food_id,
    jsonb_object_agg(e.nutrient_key, s.kind::text) AS patch
  FROM public.food_nutrient_evidence e
  JOIN public.food_sources s ON s.id = e.source_id
  JOIN public.foods f2 ON f2.id = e.food_id
  WHERE e.is_current
    AND s.is_current
    AND s.fetch_status = 'fetched'
    AND f2.nutrient_sources ->> e.nutrient_key IN ('manufacturer', 'kr_label')
    AND f2.nutrient_sources ->> e.nutrient_key <> s.kind::text
  GROUP BY e.food_id
) x
WHERE f.id = x.food_id;

-- ── 새 제약 ──────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX food_sources_current_fetched_url_idx
  ON public.food_sources (food_id, url)
  WHERE is_current AND fetch_status = 'fetched';

-- ── 교체 RPC 를 URL 기준으로 ─────────────────────────────────────────────────
-- 같은 종류가 아니라 같은 URL 의 이전 캡처를 교체한다. content_status 의
-- initial/unchanged/changed 판정도 같은 기준으로 옮긴다.

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

-- ── 단언 ─────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM public.food_sources
  WHERE kind = 'kr_label' AND is_current AND fetch_status = 'fetched'
    AND captured_text !~ '[가-힣]';
  IF bad <> 0 THEN RAISE EXCEPTION '한글 없는 kr_label 현행 출처 %건', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT food_id, url FROM public.food_sources
    WHERE is_current AND fetch_status = 'fetched'
    GROUP BY 1, 2 HAVING count(*) > 1
  ) x;
  IF bad <> 0 THEN RAISE EXCEPTION '같은 URL 현행 출처가 여럿인 사료 %건', bad; END IF;

  SELECT count(*) INTO bad
  FROM public.food_nutrient_evidence e
  JOIN public.food_sources s ON s.id = e.source_id
  WHERE e.is_current AND NOT (s.is_current AND s.fetch_status = 'fetched');
  IF bad <> 0 THEN RAISE EXCEPTION '받쳐지지 않는 근거 %건', bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT food_id, nutrient_key FROM public.food_nutrient_evidence
    WHERE is_current GROUP BY 1, 2 HAVING count(*) > 1
  ) x;
  IF bad <> 0 THEN RAISE EXCEPTION '키당 현행 근거가 여럿인 사료 %건', bad; END IF;

  -- 값의 태그가 그 값을 받치는 출처의 종류와 어긋나면 안 된다. 이 마이그레이션이
  -- 고치려던 거짓말이 바로 그것이다.
  SELECT count(*) INTO bad
  FROM public.foods f
  CROSS JOIN unnest(ARRAY['protein_pct','fat_pct','fiber_pct','ash_pct','moisture_pct',
                          'calcium_pct','phosphorus_pct','kcal_per_kg','carb_pct']) AS k(key)
  JOIN public.food_nutrient_evidence e
    ON e.food_id = f.id AND e.nutrient_key = k.key AND e.is_current
  JOIN public.food_sources s
    ON s.id = e.source_id AND s.is_current AND s.fetch_status = 'fetched'
  WHERE f.nutrient_sources ->> k.key IN ('manufacturer', 'kr_label')
    AND f.nutrient_sources ->> k.key <> s.kind::text;
  IF bad <> 0 THEN RAISE EXCEPTION '값의 태그가 받치는 출처와 어긋난 것 %건', bad; END IF;

  -- 발행된 행은 실측 태그가 붙은 값마다 현행 근거가 있어야 한다.
  SELECT count(*) INTO bad
  FROM public.foods f
  CROSS JOIN unnest(ARRAY['protein_pct','fat_pct','fiber_pct','ash_pct','moisture_pct',
                          'calcium_pct','phosphorus_pct','kcal_per_kg','carb_pct']) AS k(key)
  WHERE f.published_at IS NOT NULL
    AND f.nutrient_sources ->> k.key IN ('manufacturer', 'kr_label')
    AND (to_jsonb(f) ->> k.key) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.food_nutrient_evidence e
      JOIN public.food_sources s ON s.id = e.source_id
      WHERE e.food_id = f.id AND e.nutrient_key = k.key AND e.is_current
        AND s.is_current AND s.fetch_status = 'fetched'
    );
  IF bad <> 0 THEN RAISE EXCEPTION '근거 없이 발행된 값 %건', bad; END IF;
END $verify$;

COMMIT;
