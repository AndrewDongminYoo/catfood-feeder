-- 브랜드에 한국어 표기 자리를 따로 만든다.
--
-- 지금 `name`에는 펫프렌즈가 쓰는 한글 표기가 들어 있다(아카나·레오나르도는 병합
-- 과정에서 영문으로 올라갔고 나머지 100여 개는 한글). 그래서 `name` 하나가 "정규
-- 브랜드명"과 "국내 유통 표기" 두 역할을 겸하고 있고, 둘 중 하나를 고르면 다른
-- 하나가 사라진다 — 영문으로 통일하면 국내 검색 키를 잃고, 한글로 두면 제조사
-- 사이트를 찾을 근거가 없다.
--
-- `ko_name`이 국내 표기를 들고, `name`은 정규 브랜드명이 된다. 표시·검색 코드는
-- 계속 `name`을 읽으므로 조사 결과가 채워지는 만큼 자연히 정확해진다.
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS ko_name text;

-- 현재 값은 전부 국내 표기이므로 그대로 옮긴다. ACANA처럼 이미 영문인 행도
-- 한국에서 그 표기로 유통되므로 국내 표기로서 유효하다.
UPDATE public.brands SET ko_name = name WHERE ko_name IS NULL;

ALTER TABLE public.brands
  ALTER COLUMN ko_name SET NOT NULL;

-- 국내 표기는 브랜드를 식별한다. 적재가 이 이름으로 매칭하므로 중복이 생기면
-- 같은 브랜드가 둘로 갈린다 — 레오나르도/LEONARDO가 그렇게 갈렸었다.
CREATE UNIQUE INDEX IF NOT EXISTS brands_ko_name_normalized_idx
  ON public.brands (lower(ko_name));

COMMENT ON COLUMN public.brands.ko_name IS
  '국내 유통 표기(펫프렌즈 기준). 적재·검색의 매칭 키.';
COMMENT ON COLUMN public.brands.name IS
  '정규 브랜드명. 조사로 확정되기 전에는 ko_name과 같을 수 있다.';
COMMENT ON COLUMN public.brands.country IS
  '브랜드 원산국. 영문 전체 이름을 쓴다(예: Canada). 국내 브랜드는 South Korea.';
COMMENT ON COLUMN public.brands.importer IS
  '국내 수입사. 국내 브랜드는 NULL이며, 그 자체가 수입 여부를 뜻하지는 않는다.';
