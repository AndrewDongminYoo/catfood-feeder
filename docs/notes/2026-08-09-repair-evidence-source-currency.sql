-- 근거를 뒷받침하는 출처를 다시 현행으로 되돌린다.
--
-- 증상: 발행이 400을 낸다. 발행 RPC의 근거 검사는 `source.is_current`를 조인하므로,
-- 근거가 현행이어도 그 근거가 가리키는 출처가 은퇴돼 있으면 missing_evidence가 된다.
-- 131개 사료가 그 상태였다.
--
-- 어느 출처를 살릴지: 종류당 근거를 가장 많이 뒷받침하는 것. 종류당 현행은 하나뿐이므로
-- (UNIQUE (food_id, kind) WHERE is_current AND fetched) 나머지에 걸린 근거는 내린다.
-- 값 자체는 컬럼에 남지만 근거가 없어지므로, 그 사료는 발행 시점에 missing_evidence로
-- 정직하게 막힌다 — 근거 없는 값을 발행하는 것보다 낫다.

BEGIN;

CREATE TEMP TABLE keeper AS
SELECT DISTINCT ON (x.food_id, x.kind) x.food_id, x.kind, x.source_id
FROM (
  SELECT e.food_id, s.kind, e.source_id, count(*) AS backed,
         bool_or(s.is_current AND s.fetch_status = 'fetched') AS already_current
  FROM public.food_nutrient_evidence e
  JOIN public.food_sources s ON s.id = e.source_id
  WHERE e.is_current
  GROUP BY e.food_id, s.kind, e.source_id
) x
-- 이미 현행인 출처가 있으면 그것을 우선한다. 멀쩡한 것을 바꾸지 않는다.
ORDER BY x.food_id, x.kind, x.already_current DESC, x.backed DESC, x.source_id;

-- 살릴 출처와 종류가 겹치는 다른 현행 출처를 먼저 내린다. UNIQUE 인덱스가 있어
-- 순서를 바꾸면 아래 UPDATE가 위반으로 터진다.
UPDATE public.food_sources s
SET is_current = false
FROM keeper k
WHERE s.food_id = k.food_id
  AND s.kind = k.kind
  AND s.id <> k.source_id
  AND s.is_current
  AND s.fetch_status = 'fetched';

UPDATE public.food_sources s
SET is_current = true
FROM keeper k
WHERE s.id = k.source_id
  AND s.fetch_status = 'fetched'
  AND NOT s.is_current;

-- 살아남지 못한 출처에 걸린 근거는 내린다. 그대로 두면 발행이 그 근거를 찾다가
-- 실패하고, 왜 실패하는지도 드러나지 않는다.
UPDATE public.food_nutrient_evidence e
SET is_current = false
WHERE e.is_current
  AND NOT EXISTS (
    SELECT 1 FROM public.food_sources s
    WHERE s.id = e.source_id AND s.is_current AND s.fetch_status = 'fetched'
  );

DO $$
DECLARE orphan int; dup int;
BEGIN
  SELECT count(*) INTO orphan
  FROM public.food_nutrient_evidence e
  JOIN public.food_sources s ON s.id = e.source_id
  WHERE e.is_current AND NOT (s.is_current AND s.fetch_status = 'fetched');
  IF orphan <> 0 THEN RAISE EXCEPTION '근거를 뒷받침하지 못하는 출처 %건', orphan; END IF;

  SELECT count(*) INTO dup FROM (
    SELECT food_id, kind FROM public.food_sources
    WHERE is_current AND fetch_status = 'fetched'
    GROUP BY 1,2 HAVING count(*) > 1
  ) x;
  IF dup <> 0 THEN RAISE EXCEPTION '종류당 현행 출처가 여럿인 사료 %건', dup; END IF;
END $$;

COMMIT;
