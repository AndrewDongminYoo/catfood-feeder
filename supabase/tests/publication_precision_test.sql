BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(3);

INSERT INTO auth.users (id)
VALUES ('00000000-0000-0000-0000-000000096001'::uuid);

INSERT INTO public.brands (id, name, ko_name)
OVERRIDING SYSTEM VALUE
VALUES (-96001, 'pgTAP precision brand', 'pgTAP precision brand');

INSERT INTO public.foods (id, brand_id, product_name)
OVERRIDING SYSTEM VALUE
VALUES (-96001, -96001, 'pgTAP precision food');

INSERT INTO public.food_sources (
  id, food_id, kind, url, capture_method, fetch_status,
  captured_at, content_hash, captured_text, is_current
)
OVERRIDING SYSTEM VALUE
VALUES (
  -96001, -96001, 'manufacturer', 'https://example.com/label', 'fetch',
  'fetched', now(), repeat('a', 64), '인 0.895% 이상', true
);

-- 라벨이 소수점 3자리를 표기하면 foods 컬럼(numeric(5,2))은 0.90으로 반올림되고
-- 근거 원장은 0.895를 그대로 보존한다. 발행이 이 둘을 정밀도 그대로 비교하면
-- 그 사료는 영구히 evidence_mismatch가 된다 — 재적용으로도 못 빠져나온다.
SELECT lives_ok(
  $$ SELECT public.apply_food_evidence_draft(
       -96001,
       '[{"excerpt":"인 0.895% 이상","nutrient_key":"phosphorus_pct","source_id":-96001,"value":0.895}]'::jsonb
     ) $$,
  'a three-decimal label value applies'
);

SELECT isnt(
  (
    SELECT phosphorus_pct
    FROM public.foods
    WHERE id = -96001
  ),
  (
    SELECT value
    FROM public.food_nutrient_evidence
    WHERE food_id = -96001
  ),
  'the stored column and the evidence ledger really do differ'
);

SELECT is(
  (
    SELECT public.publish_food_draft(
      -96001,
      '00000000-0000-0000-0000-000000096001'::uuid,
      (
        SELECT updated_at
        FROM public.foods
        WHERE id = -96001
      ),
      '{"carbPct": null, "carbIsEstimated": false, "energyPPct": null, "energyFPct": null, "energyCPct": null, "nutrientSources": {}}'::jsonb
    ) ->> 'status'
  ),
  'published',
  'publication compares at the column scale instead of rejecting forever'
);

SELECT * FROM finish();
ROLLBACK;
