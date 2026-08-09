-- 같은 레시피의 중복 행을 하나로 병합한다.
--
-- 삭제만으로는 안 된다: foods의 FK가 전부 CASCADE라 지우는 순간 그 행이 들고 있던
-- 출처·근거·원장이 함께 사라진다. 그래서 자식들을 생존 행으로 옮긴 뒤에 지운다.
--
-- 옮기기 전에 강등이 필요하다. UNIQUE (food_id, nutrient_key) WHERE is_current 와
-- UNIQUE (food_id, kind) WHERE is_current AND fetched 때문에, 생존 행이 이미 가진
-- 키/종류를 그대로 옮기면 제약을 위반한다. 생존 행 것을 남기고 옮겨오는 쪽을 내린다.

BEGIN;

CREATE TEMP TABLE merge_plan AS
WITH ranked AS (
  SELECT f.id, f.brand_id, f.product_name,
         row_number() OVER (
           PARTITION BY f.brand_id, lower(replace(replace(replace(f.product_name,' ',''),'&',''),'-',''))
           ORDER BY (SELECT count(*) FROM food_nutrient_evidence e
                     WHERE e.food_id = f.id AND e.is_current) DESC,
                    (f.protein_pct IS NOT NULL) DESC,
                    (f.published_at IS NOT NULL) DESC,
                    -- 한글 띄어쓰기가 살아 있는 이름을 남긴다("탑 마운틴" > "탑마운틴").
                    length(f.product_name) - length(replace(f.product_name,' ','')) DESC,
                    f.id
         ) rn
  FROM foods f
),
survivors AS (
  SELECT brand_id, lower(replace(replace(replace(product_name,' ',''),'&',''),'-','')) squashed, id AS survivor_id FROM ranked WHERE rn = 1
)
SELECT r.id AS loser_id, s.survivor_id
FROM ranked r
JOIN survivors s ON s.brand_id = r.brand_id
  AND s.squashed = lower(replace(replace(replace(r.product_name,' ',''),'&',''),'-',''))
WHERE r.rn > 1;

-- 값이 어긋나는 그룹은 병합 전에 생존 행에 기록해 둔다. 자동으로 한쪽을 고르면
-- 두 실제 페이지가 다른 값을 말한다는 사실 자체가 사라진다.
UPDATE foods f
SET source_conflicts = coalesce(f.source_conflicts, '[]'::jsonb) || conflicts.payload
FROM (
  SELECT m.survivor_id,
         jsonb_agg(jsonb_build_object(
           'key', e.nutrient_key,
           'kind', 'duplicate_listing',
           'survivor_value', sv.value,
           'merged_value', e.value,
           'merged_from_food_id', e.food_id
         )) payload
  FROM merge_plan m
  JOIN food_nutrient_evidence e ON e.food_id = m.loser_id AND e.is_current
  JOIN food_nutrient_evidence sv ON sv.food_id = m.survivor_id
       AND sv.nutrient_key = e.nutrient_key AND sv.is_current
  WHERE sv.value IS DISTINCT FROM e.value
  GROUP BY m.survivor_id
) conflicts
WHERE f.id = conflicts.survivor_id;

-- 생존 행이 이미 그 영양 키를 current로 들고 있으면, 옮겨오는 근거는 내린다.
UPDATE food_nutrient_evidence e
SET is_current = false
FROM merge_plan m
WHERE e.food_id = m.loser_id
  AND e.is_current
  AND EXISTS (
    SELECT 1 FROM food_nutrient_evidence sv
    WHERE sv.food_id = m.survivor_id AND sv.nutrient_key = e.nutrient_key AND sv.is_current
  );

-- 출처도 같다. 종류당 current fetched는 하나뿐이다.
UPDATE food_sources s
SET is_current = false
FROM merge_plan m
WHERE s.food_id = m.loser_id
  AND s.is_current AND s.fetch_status = 'fetched'
  AND EXISTS (
    SELECT 1 FROM food_sources sv
    WHERE sv.food_id = m.survivor_id AND sv.kind = s.kind
      AND sv.is_current AND sv.fetch_status = 'fetched'
  );

-- 위 두 강등은 생존 행하고만 비교한다. 그런데 한 그룹에 loser가 여럿이면 그들끼리
-- 같은 키/종류를 current로 들고 있을 수 있고, 그건 어느 쪽도 강등되지 않은 채
-- 이동 시점에 충돌한다. 이동 후의 food_id 기준으로 그룹 전체에서 하나만 남긴다.
-- 사료 하나당 최종 대상 하나. loser를 자기 자신에도 매핑하면 아래 DISTINCT ON이
-- loser마다 별도 그룹을 만들어 아무것도 강등하지 않고, 충돌은 이동 시점에 터진다.
CREATE TEMP TABLE target_of AS
SELECT f.id AS food_id, coalesce(m.survivor_id, f.id) AS target
FROM foods f
LEFT JOIN merge_plan m ON m.loser_id = f.id;

UPDATE food_nutrient_evidence e
SET is_current = false
WHERE e.is_current
  AND e.id NOT IN (
    SELECT DISTINCT ON (t.target, x.nutrient_key) x.id
    FROM food_nutrient_evidence x
    JOIN target_of t ON t.food_id = x.food_id
    WHERE x.is_current
    ORDER BY t.target, x.nutrient_key,
             (x.food_id = t.target) DESC, x.captured_at DESC, x.id DESC
  );

UPDATE food_sources s
SET is_current = false
WHERE s.is_current AND s.fetch_status = 'fetched'
  AND s.id NOT IN (
    SELECT DISTINCT ON (t.target, x.kind) x.id
    FROM food_sources x
    JOIN target_of t ON t.food_id = x.food_id
    WHERE x.is_current AND x.fetch_status = 'fetched'
    ORDER BY t.target, x.kind,
             (x.food_id = t.target) DESC, x.captured_at DESC NULLS LAST, x.id DESC
  );

UPDATE food_nutrient_evidence e SET food_id = m.survivor_id FROM merge_plan m WHERE e.food_id = m.loser_id;
UPDATE food_sources s          SET food_id = m.survivor_id FROM merge_plan m WHERE s.food_id = m.loser_id;
UPDATE food_research_runs r    SET food_id = m.survivor_id FROM merge_plan m WHERE r.food_id = m.loser_id;
UPDATE recalls rc              SET food_id = m.survivor_id FROM merge_plan m WHERE rc.food_id = m.loser_id;

-- 옮겨온 근거 중 생존 행에 비어 있던 키를 채운다. 상호보완 병합이 여기서 실현된다
-- (한 행은 protein/fat, 다른 행은 kcal만 가진 경우).
DO $$
DECLARE k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['protein_pct','fat_pct','fiber_pct','ash_pct','moisture_pct',
                           'calcium_pct','phosphorus_pct','kcal_per_kg','carb_pct']
  LOOP
    EXECUTE format($f$
      UPDATE foods f
      SET %1$I = e.value,
          nutrient_sources = coalesce(f.nutrient_sources, '{}'::jsonb)
                             || jsonb_build_object(%1$L, s.kind::text),
          updated_at = statement_timestamp()
      FROM food_nutrient_evidence e
      JOIN food_sources s ON s.id = e.source_id
      WHERE e.food_id = f.id AND e.is_current AND e.nutrient_key = %1$L
        AND f.%1$I IS NULL
    $f$, k);
  END LOOP;
END $$;

DELETE FROM foods WHERE id IN (SELECT loser_id FROM merge_plan);

DO $$
DECLARE dup int; orphan int;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT brand_id, lower(replace(replace(replace(product_name,' ',''),'&',''),'-','')) FROM foods GROUP BY 1,2 HAVING count(*) > 1
  ) x;
  IF dup <> 0 THEN RAISE EXCEPTION '중복 그룹이 %개 남았다', dup; END IF;

  SELECT count(*) INTO orphan FROM food_nutrient_evidence e
  WHERE NOT EXISTS (SELECT 1 FROM foods f WHERE f.id = e.food_id);
  IF orphan <> 0 THEN RAISE EXCEPTION '고아 근거 %건', orphan; END IF;
END $$;

COMMIT;
