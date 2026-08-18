-- 발행된 사료의 근거만 공개한다. 초안(published_at IS NULL)의 근거는 계속 비공개다.
-- captured_text 는 페이지 본문 전체라 컬럼 단위로 제외한다 — 인용 구절은 evidence.excerpt 가 가진다.

CREATE POLICY "public read evidence of published foods"
  ON public.food_nutrient_evidence FOR SELECT
  TO anon, authenticated
  USING (
    is_current
    AND EXISTS (
      SELECT 1 FROM public.foods f
      WHERE f.id = public.food_nutrient_evidence.food_id AND f.published_at IS NOT NULL
    )
    -- 인용문은 그것을 낳은 소스 없이 공개되지 않는다. 앱의 조인이 그 규칙을 지키지만
    -- 조인은 Data API 직접 조회를 구속하지 못하므로, 경계는 정책이 들고 있어야 한다.
    -- 이 서브쿼리도 food_sources 의 RLS 를 거치므로 is_current 와 fetch_status 를
    -- 다시 쓰지 않는다 — 아래 정책이 이미 은퇴·실패 캡처를 숨기고, 그 두 컬럼은
    -- anon 에게 부여되지 않아 여기서 읽으면 정책이 통째로 permission denied 가 된다.
    AND EXISTS (
      SELECT 1 FROM public.food_sources s
      WHERE s.id = public.food_nutrient_evidence.source_id
        AND s.food_id = public.food_nutrient_evidence.food_id
    )
  );

CREATE POLICY "public read sources of published foods"
  ON public.food_sources FOR SELECT
  TO anon, authenticated
  USING (
    is_current
    AND fetch_status = 'fetched'
    AND EXISTS (
      SELECT 1 FROM public.foods f
      WHERE f.id = public.food_sources.food_id AND f.published_at IS NOT NULL
    )
  );

GRANT SELECT ON TABLE public.food_nutrient_evidence TO anon, authenticated;
GRANT SELECT (id, food_id, kind, url, capture_method, captured_at)
  ON TABLE public.food_sources TO anon, authenticated;
