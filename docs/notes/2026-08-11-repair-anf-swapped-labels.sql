-- ANF 인도어 캣: 41(웨이트케어)과 84(어덜트)에 서로 상대 제품의 상세 이미지가
-- 지정돼 전사됐다. 이미지에 인쇄된 제품명으로 확인한 사실이다(HACCP 인증서 바로
-- 아래 띠, 원본 y 3500~4400):
--
--   a8ac67d4… "인도어 캣 어덜트"      → food 41 웨이트케어에 적용됨 (run 518)
--   13762e40… "인도어 캣 웨이트케어"  → food 84 어덜트에 제안됨   (run 520)
--   a73580d2… "인도어 캣 키튼"        → food 321 키튼             (run 519, 정상)
--
-- 저장된 제조사 값이 같은 방향을 가리킨다 — 41은 29/10/5를 들고 34.5/12/6 라벨을,
-- 84는 34/12/5를 들고 29.5/10/6 라벨을 받았다. 각 라벨이 상대 제품의 값에 맞는다.
--
-- run 518은 이미 적용돼 food 41에 근거 2행을 남겼다. 수분 12.0은 두 라벨이 우연히
-- 같아 값 자체는 맞지만 출처가 다른 제품의 페이지다 — 이 프로젝트에서 출처가 틀린
-- 값은 맞는 값이 아니다. 열량 3,550은 어덜트의 수치이고 웨이트케어는 3,350이다.
--
-- 그래서 둘 다 회수하고 컬럼과 태그까지 되돌린 뒤, 올바른 이미지로 다시 전사해
-- 운영자 승인으로 채운다. 41은 미발행이라 공개 카탈로그에는 나가지 않았다.
BEGIN;

DO $$
DECLARE
  n int;
BEGIN
  -- 1. 웨이트케어 라벨로 만들어진 어덜트(84) 제안을 닫는다. 그대로 두면 승인 화면에
  --    올바른 제안과 나란히 떠서 어느 쪽이든 눌릴 수 있다.
  UPDATE food_research_runs SET status = 'rejected'
  WHERE id = 520 AND status = 'pending_review';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'run 520 반려 대상 %건 (기대 1)', n;
  END IF;

  -- 2. 어덜트 페이지에서 나온 근거를 회수한다.
  UPDATE food_nutrient_evidence SET is_current = false
  WHERE food_id = 41 AND source_id = 753 AND is_current;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN
    RAISE EXCEPTION 'food 41 근거 회수 %건 (기대 2: moisture_pct, kcal_per_kg)', n;
  END IF;

  -- 3. 출처 자체도 회수한다. 근거가 사라지면 좌초 출처로 남는다.
  UPDATE food_sources SET is_current = false
  WHERE id = 753 AND food_id = 41 AND is_current;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'food 41 출처 753 회수 %건 (기대 1)', n;
  END IF;

  -- 4. 그 근거가 뒷받침하던 컬럼과 출처 태그를 되돌린다. 태그를 남기면 근거 없는
  --    kr_label 값이 되어 detectUnbackedSources가 잡는 상태가 된다.
  UPDATE foods
  SET moisture_pct = NULL,
      kcal_per_kg = NULL,
      nutrient_sources = nutrient_sources - 'moisture_pct' - 'kcal_per_kg'
  WHERE id = 41;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'food 41 컬럼 정정 %건 (기대 1)', n;
  END IF;
END $$;

-- 확인: 41은 제조사 근거 6건만 남고, 수분/열량은 비어 있어야 한다.
SELECT
  f.id,
  f.moisture_pct,
  f.kcal_per_kg,
  f.nutrient_sources ? 'moisture_pct' AS has_moisture_tag,
  f.nutrient_sources ? 'kcal_per_kg' AS has_kcal_tag,
  (SELECT count(*) FROM food_nutrient_evidence e
   WHERE e.food_id = f.id AND e.is_current) AS current_evidence,
  (SELECT count(*) FROM food_sources s
   WHERE s.food_id = f.id AND s.is_current) AS current_sources
FROM foods f
WHERE f.id = 41;

SELECT id, food_id, status FROM food_research_runs WHERE id IN (519, 520) ORDER BY id;

COMMIT;
