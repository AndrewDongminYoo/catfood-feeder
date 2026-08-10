-- 스코프에서 빠진 브랜드의 사료를 지운다.
--
-- 20260810140000_brand_scope.sql 이 brands.in_scope 를 정하고, 이 노트가 그 결정을
-- 실제 행에 적용한다. 지우는 이유는 남겨 두면 조사 스크립트마다 필터를 하나씩 더
-- 붙여야 하고, 그중 하나만 빠뜨려도 조용히 다시 대상이 되기 때문이다. 인제스트가
-- in_scope 를 존중하므로 다시 살아나지도 않는다.
--
-- 되돌릴 수 있다: pet-fritends.json 이 저장소에 있고 scripts/ingest-petfriends.mjs 가
-- 골격을 재생한다. 잃는 것은 이 사료들에 붙어 있던 근거와 출처뿐이고, 그건 아래에서
-- 몇 건인지 세어 둔다.
--
-- 지우기 전에 확인하는 것: 발행된 행은 공개 카탈로그에서 사라진다. 이번 대상 4건
-- (네츄럴코어 1, 캣템 2, 벤티 1)은 운영자가 명시적으로 뺀 것이다.

BEGIN;

CREATE TEMP TABLE doomed AS
SELECT
  f.id,
  f.published_at IS NOT NULL AS was_published
FROM public.foods f
JOIN public.brands b ON b.id = f.brand_id
WHERE NOT b.in_scope;

DO $guard$
DECLARE n int; pub int; imported int;
BEGIN
  SELECT count(*) INTO n FROM doomed;
  SELECT count(*) INTO pub FROM doomed WHERE was_published;

  -- 수입 사료가 한 건이라도 섞이면 조건이 잘못 걸린 것이다. 멈춘다.
  SELECT count(*) INTO imported
  FROM doomed d
  JOIN public.foods f ON f.id = d.id
  JOIN public.brands b ON b.id = f.brand_id
  WHERE b.country IS DISTINCT FROM 'South Korea';
  IF imported <> 0 THEN
    RAISE EXCEPTION '수입 사료 %건이 삭제 대상에 들어왔다', imported;
  END IF;

  -- 급여기록은 ON DELETE RESTRICT 라 삭제를 막는다. 사용자 데이터가 걸려 있으면
  -- 조용히 실패하는 대신 여기서 이유를 밝히고 멈춘다.
  IF EXISTS (SELECT 1 FROM public.feeding_logs g JOIN doomed d ON d.id = g.food_id) THEN
    RAISE EXCEPTION '급여기록이 걸린 사료가 있다 — 삭제 전에 사람이 판단해야 한다';
  END IF;

  RAISE NOTICE '삭제 대상 %건 (발행 중 %건)', n, pub;
END $guard$;

DELETE FROM public.foods
WHERE id IN (SELECT id FROM doomed);

DO $verify$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM public.foods f
  JOIN public.brands b ON b.id = f.brand_id
  WHERE NOT b.in_scope;
  IF bad <> 0 THEN RAISE EXCEPTION '스코프 밖 사료가 %건 남았다', bad; END IF;

  SELECT count(*) INTO bad
  FROM public.food_nutrient_evidence e
  WHERE NOT EXISTS (SELECT 1 FROM public.foods f WHERE f.id = e.food_id);
  IF bad <> 0 THEN RAISE EXCEPTION '고아 근거 %건', bad; END IF;

  SELECT count(*) INTO bad
  FROM public.food_sources s
  WHERE NOT EXISTS (SELECT 1 FROM public.foods f WHERE f.id = s.food_id);
  IF bad <> 0 THEN RAISE EXCEPTION '고아 출처 %건', bad; END IF;

  -- 남은 발행 행은 여전히 값마다 현행 근거가 있어야 한다.
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
