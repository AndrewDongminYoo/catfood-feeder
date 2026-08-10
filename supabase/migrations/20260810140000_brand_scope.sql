-- 카탈로그에 실을 브랜드인지를 브랜드가 스스로 들고 있게 한다.
--
-- 지금까지 스코프는 어디에도 적혀 있지 않았다. 인제스트가 Pet Friends 목록을 통째로
-- 골격으로 적재했고, 그 뒤로 "이건 조사 대상인가"를 물어볼 곳이 없어서 조사 스크립트가
-- 매번 전부를 대상으로 삼았다.
--
-- 운영자 판단(2026-08-10): 수입 사료는 통관·등록 절차가 데이터를 뒷받침하지만, 내수
-- 전용 사료는 그 뒷받침이 없다. 제조사가 자기 사이트에 성분표를 올리지 않은 제품이
-- 많고(대주펫푸드는 제품 페이지 35개 중 캐츠랑이 2개인데 카탈로그엔 9개였다), 그런
-- 경우 남는 출처는 유통 상세페이지 이미지뿐인데 그것이 언제 찍힌 라벨인지 확인할 1차
-- 출처가 없다. 이 프로젝트가 출처 원장까지 만들어 지키려는 보증을 그 경로로 들어온
-- 값은 받지 못한다.
--
-- 국내 중 남기는 것은 우리와와 동원F&B 의 브랜드다. 기준은 브랜드 단위이며 국적이
-- 아니다 — 그래서 country 로 거르지 않고 컬럼을 따로 둔다. 판단이 바뀌면 이 컬럼
-- 한 칸만 되돌리면 된다.
--
-- 제조사 표기가 갈려 있어(Wooriwa / Urriwa 가 같은 회사, Sajo 가 셋으로) 제조사
-- 문자열로 고르지 않고 브랜드명을 명시한다. 표기 정규화는 별건이다.

BEGIN;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS in_scope boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.brands.in_scope IS
  '카탈로그 편집 판단. false면 조사 대상에서 빠지고 인제스트가 골격을 만들지 않는다. 국적이 아니라 결정이다.';

UPDATE public.brands
SET in_scope = false
WHERE country = 'South Korea'
  AND ko_name NOT IN (
    -- 우리와
    'ANF',
    '닥터힐메딕스',
    '웰츠',
    '이즈칸',
    '프로베스트',
    -- 동원F&B
    '뉴트리플랜'
  );

DO $verify$
DECLARE bad int; kept int;
BEGIN
  -- 수입 브랜드는 하나도 빠지지 않아야 한다.
  SELECT count(*) INTO bad
  FROM public.brands
  WHERE NOT in_scope AND country IS DISTINCT FROM 'South Korea';
  IF bad <> 0 THEN RAISE EXCEPTION '수입 브랜드가 스코프에서 빠졌다 (%건)', bad; END IF;

  -- 남기기로 한 여섯이 전부 남아야 한다. 이름이 하나라도 어긋나면 여기서 걸린다.
  SELECT count(*) INTO kept
  FROM public.brands
  WHERE in_scope
    AND ko_name IN ('ANF', '닥터힐메딕스', '웰츠', '이즈칸', '프로베스트', '뉴트리플랜');
  IF kept <> 6 THEN RAISE EXCEPTION '유지 대상 6개 중 %개만 남았다', kept; END IF;

  SELECT count(*) INTO bad
  FROM public.brands
  WHERE NOT in_scope AND country = 'South Korea';
  RAISE NOTICE '국내 브랜드 %개를 스코프에서 제외했다', bad;
END $verify$;

COMMIT;
