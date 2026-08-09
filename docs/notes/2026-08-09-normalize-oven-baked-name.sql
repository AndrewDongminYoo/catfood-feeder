-- Oven-Baked Tradition 의 한글 표기를 "오븐베이크"로 통일한다.
--
-- 중복 병합(2026-08-09-merge-cross-language-duplicates.sql) 뒤 네 행이 오븐베이크
-- 둘, 오븐베이크드 둘로 갈려 있었다. 생존 행을 근거 수로 골랐더니 표기가 섞인 것이라,
-- 병합이 만든 불일치를 병합이 정리한다.
--
-- 영문 브랜드명(Oven-Baked Tradition)의 음차로는 "오븐베이크드"가 가깝지만, 국내에서
-- 더 널리 쓰이는 표기를 따른다 — 운영자 결정. 카탈로그는 한국 시장을 문서화하고,
-- 검색으로 찾을 이름이 그쪽이다.

BEGIN;

UPDATE public.foods
SET product_name = replace(product_name, '오븐베이크드 ', '오븐베이크 '),
    updated_at = statement_timestamp()
WHERE brand_id = (
  SELECT id FROM public.brands
  WHERE name = 'Oven-Baked Tradition'
)
AND product_name LIKE '오븐베이크드 %';

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM public.foods
  WHERE brand_id = (SELECT id FROM public.brands WHERE name = 'Oven-Baked Tradition')
    AND product_name NOT LIKE '오븐베이크 %';
  IF bad <> 0 THEN RAISE EXCEPTION '오븐베이크로 시작하지 않는 행 %건', bad; END IF;

  -- 이름을 바꾸다 같은 브랜드 안에서 충돌하면 새 중복을 만든 것이다.
  SELECT count(*) INTO bad FROM (
    SELECT brand_id, product_name FROM public.foods
    GROUP BY 1, 2 HAVING count(*) > 1
  ) x;
  IF bad <> 0 THEN RAISE EXCEPTION '이름이 겹치는 그룹 %건', bad; END IF;
END $$;

COMMIT;
