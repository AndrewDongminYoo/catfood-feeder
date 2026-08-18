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
