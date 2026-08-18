BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(5);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-93001, 'pgTAP evidence brand', 'pgTAP evidence brand', 'pgTAP manufacturer');

INSERT INTO public.foods (id, brand_id, product_name, data_verified_at, published_at, verification_method)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'pgTAP published food', '2026-08-18 00:00:00+00'::timestamptz,
   '2026-08-18 00:00:00+00'::timestamptz, 'legacy_human'),
  (-93002, -93001, 'pgTAP draft food', NULL, NULL, NULL);

INSERT INTO public.food_sources
  (id, food_id, kind, url, capture_method, fetch_status, captured_at, content_hash, captured_text, is_current)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'manufacturer', 'https://example.test/published', 'fetch', 'fetched',
   '2026-08-18 00:00:00+00'::timestamptz, 'pgtap-hash-93001', 'published body', true),
  (-93002, -93002, 'manufacturer', 'https://example.test/draft', 'fetch', 'fetched',
   '2026-08-18 00:00:00+00'::timestamptz, 'pgtap-hash-93002', 'draft body', true);

INSERT INTO public.food_nutrient_evidence
  (id, food_id, nutrient_key, source_id, value, excerpt, captured_at, is_current)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'protein_pct', -93001, 36, 'Crude Protein 36.00%',
   '2026-08-18 00:00:00+00'::timestamptz, true),
  (-93002, -93002, 'protein_pct', -93002, 30, 'Crude Protein 30.00%',
   '2026-08-18 00:00:00+00'::timestamptz, true);

-- Supabase Cloud grants these table/column privileges to the API roles via
-- schema default privileges; a local `supabase start` does not, so anon would
-- hit a table-level "permission denied" before RLS is ever consulted. Grant
-- exactly the column scope Task 1's migration grants so the assertions test
-- the RLS policy, not the privilege baseline — captured_text stays ungranted
-- so the throws_ok assertion below still exercises a real column privilege.
-- Transactional, undone by the test's ROLLBACK.
GRANT SELECT ON public.food_nutrient_evidence TO anon;
GRANT SELECT (id, food_id, kind, url, capture_method, captured_at)
  ON public.food_sources TO anon;

SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM public.food_nutrient_evidence WHERE food_id = -93001),
  1,
  'anon reads evidence for a published food'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_nutrient_evidence WHERE food_id = -93002),
  0,
  'anon cannot read evidence for a draft food'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_sources WHERE food_id = -93001),
  1,
  'anon reads the source backing a published food'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_sources WHERE food_id = -93002),
  0,
  'anon cannot read the source of a draft food'
);

SELECT throws_ok(
  'SELECT captured_text FROM public.food_sources WHERE food_id = -93001',
  '42501',
  NULL,
  'anon cannot select captured_text from any source'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
