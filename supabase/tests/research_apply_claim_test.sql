BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(4);

INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000095001'::uuid);
INSERT INTO public.brands (id, name) OVERRIDING SYSTEM VALUE
VALUES (-95001, 'pgTAP apply-claim brand');
INSERT INTO public.foods (id, brand_id, product_name) OVERRIDING SYSTEM VALUE
VALUES (-95001, -95001, 'pgTAP apply-claim food');

-- 조사 실행이 잡은 manufacturer 출처.
INSERT INTO public.food_sources (
  id, food_id, kind, url, capture_method, fetch_status,
  captured_at, content_hash, captured_text, created_by, is_current
) OVERRIDING SYSTEM VALUE
VALUES (
  -95001, -95001, 'manufacturer', 'https://example.com/agent', 'fetch', 'fetched',
  now(), repeat('a', 64), '조단백질 36% 이상', null, true
);

SELECT lives_ok(
  $$ SELECT public.apply_food_evidence_draft(
       -95001,
       '[{"excerpt":"조단백질 36% 이상","nutrient_key":"protein_pct","source_id":-95001,"value":36}]'::jsonb,
       ARRAY[-95001]::bigint[]
     ) $$,
  'the owning run may apply its evidence'
);

SELECT is(
  (
    SELECT protein_pct
    FROM public.foods
    WHERE id = -95001
  ),
  36::numeric,
  'the value landed'
);

-- 큐레이터가 *다른 kind* 를 붙인다. 조사 출처는 은퇴되지 않아 여전히 current 다.
INSERT INTO public.food_sources (
  food_id, kind, url, capture_method, fetch_status,
  captured_at, content_hash, captured_text, created_by, is_current
) VALUES (
  -95001, 'kr_label', 'https://example.com/curator', 'fetch', 'fetched',
  now(), repeat('b', 64), '조지방 18% 이상',
  '00000000-0000-0000-0000-000000095001'::uuid, true
);

SELECT throws_ok(
  $$ SELECT public.apply_food_evidence_draft(
       -95001,
       '[{"excerpt":"조단백질 36% 이상","nutrient_key":"fat_pct","source_id":-95001,"value":18}]'::jsonb,
       ARRAY[-95001]::bigint[]
     ) $$,
  'CFCLM',
  null,
  'a run that lost the target cannot apply further evidence'
);

SELECT is(
  (
    SELECT fat_pct
    FROM public.foods
    WHERE id = -95001
  ),
  null::numeric,
  'the refused apply wrote nothing'
);

SELECT * FROM finish();
ROLLBACK;
