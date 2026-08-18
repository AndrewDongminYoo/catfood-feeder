BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(10);

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
  (id, food_id, kind, url, capture_method, fetch_status, failure_code, captured_at, content_hash, captured_text, is_current)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'manufacturer', 'https://example.test/published', 'fetch', 'fetched', NULL,
   '2026-08-18 00:00:00+00'::timestamptz, 'pgtap-hash-93001', 'published body', true),
  (-93002, -93002, 'manufacturer', 'https://example.test/draft', 'fetch', 'fetched', NULL,
   '2026-08-18 00:00:00+00'::timestamptz, 'pgtap-hash-93002', 'draft body', true),
  -- 발행된 사료에 달렸지만 은퇴한 출처. is_current 절은 이 프로젝트에서 실제로
  -- defect 이 난 적이 있는 절이라 따로 못 박는다.
  (-93003, -93001, 'manufacturer', 'https://example.test/retired', 'fetch', 'fetched', NULL,
   '2026-08-17 00:00:00+00'::timestamptz, 'pgtap-hash-93003', 'retired body', false),
  -- 수집에 실패한 출처. capture_state 제약이 failure_code 를 요구하고 본문 3열을
  -- NULL 로 못 박는다 — 인용할 구절이 애초에 없는 행이다.
  (-93004, -93001, 'manufacturer', 'https://example.test/failed', 'fetch', 'failed', 'http_404',
   NULL, NULL, NULL, true);

INSERT INTO public.food_nutrient_evidence
  (id, food_id, nutrient_key, source_id, value, excerpt, captured_at, is_current)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'protein_pct', -93001, 36, 'Crude Protein 36.00%',
   '2026-08-18 00:00:00+00'::timestamptz, true),
  (-93002, -93002, 'protein_pct', -93002, 30, 'Crude Protein 30.00%',
   '2026-08-18 00:00:00+00'::timestamptz, true),
  -- 교체된(superseded) 근거 행. 발행된 사료에 달려 있어도 보이면 안 된다.
  (-93003, -93001, 'protein_pct', -93001, 34, 'Crude Protein 34.00%',
   '2026-08-17 00:00:00+00'::timestamptz, false),
  -- current 이지만 은퇴한 캡처를 가리키는 근거. 인용문은 그것을 낳은 소스 없이
  -- 공개되지 않아야 하고, 그 규칙은 앱의 조인이 아니라 정책이 지켜야 한다.
  (-93004, -93001, 'fat_pct', -93003, 18, 'Crude Fat 18.00%',
   '2026-08-18 00:00:00+00'::timestamptz, true),
  -- current 이지만 실패한 캡처를 가리키는 근거.
  (-93005, -93001, 'fiber_pct', -93004, 4, 'Crude Fibre 4.00%',
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

-- is_current 와 fetch_status 는 컬럼 권한에 없다. anon 이 그 컬럼으로 필터하면
-- RLS 가 아니라 42501 이 나므로, 행은 id 로만 지목한다.
SELECT is(
  (SELECT count(*)::int FROM public.food_sources WHERE id = -93003),
  0,
  'anon cannot read a superseded source of a published food'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_sources WHERE id = -93004),
  0,
  'anon cannot read a failed-fetch source of a published food'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_nutrient_evidence WHERE id = -93003),
  0,
  'anon cannot read a superseded evidence row of a published food'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_nutrient_evidence WHERE id = -93004),
  0,
  'anon cannot read evidence whose backing source was retired'
);

SELECT is(
  (SELECT count(*)::int FROM public.food_nutrient_evidence WHERE id = -93005),
  0,
  'anon cannot read evidence whose backing source failed to fetch'
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
