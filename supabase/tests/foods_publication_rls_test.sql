BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(12);

INSERT INTO auth.users (id)
VALUES ('00000000-0000-0000-0000-000000092001'::uuid);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-92001, 'pgTAP publication brand', 'pgTAP publication brand', 'pgTAP manufacturer');

INSERT INTO public.foods (
  id,
  brand_id,
  product_name,
  data_verified_at,
  published_at,
  verification_method
)
OVERRIDING SYSTEM VALUE
VALUES
  (-92001, -92001, 'pgTAP draft food', NULL, NULL, NULL),
  (
    -92002,
    -92001,
    'pgTAP published food',
    '2026-07-21 00:00:00+00'::timestamptz,
    '2026-07-21 00:00:00+00'::timestamptz,
    'legacy_human'
  ),
  (
    -92003,
    -92001,
    'pgTAP reviewed but unpublished food',
    '2026-07-22 00:00:00+00'::timestamptz,
    NULL,
    NULL
  );

INSERT INTO public.cats (id, owner_id, name)
OVERRIDING SYSTEM VALUE
VALUES (
  -92001,
  '00000000-0000-0000-0000-000000092001'::uuid,
  'pgTAP publication cat'
);

-- Supabase Cloud grants these table privileges to the API roles via schema
-- default privileges; a local `supabase start` does not, so anon/authenticated
-- would hit a table-level "permission denied" before RLS is ever consulted.
-- Grant exactly what the roles exercise so the test reaches the policy layer it
-- is actually asserting. Transactional, undone by the test's ROLLBACK.
GRANT SELECT ON public.foods TO anon, authenticated, service_role;
GRANT SELECT ON public.cats TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.feeding_logs TO authenticated;

SET LOCAL ROLE anon;

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id IN (-92001, -92002, -92003)
  ),
  1::bigint,
  'anon can read only verified foods'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id = -92001
  ),
  0::bigint,
  'anon cannot read draft foods'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id = -92003
  ),
  0::bigint,
  'anon cannot read a reviewed but unpublished food'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000092001',
  TRUE
);
SET LOCAL ROLE authenticated;

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id IN (-92001, -92002, -92003)
  ),
  1::bigint,
  'authenticated can read only verified foods'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id = -92001
  ),
  0::bigint,
  'authenticated cannot read draft foods'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id = -92003
  ),
  0::bigint,
  'authenticated cannot read a reviewed but unpublished food'
);

SELECT lives_ok(
  $$
    INSERT INTO public.feeding_logs (cat_id, food_id, started_on)
    VALUES (-92001, -92002, '2026-07-21'::date)
  $$,
  'an owner can create a feeding log for a verified food'
);

SELECT throws_ok(
  $$
    INSERT INTO public.feeding_logs (cat_id, food_id, started_on)
    VALUES (-92001, -92003, '2026-07-22'::date)
  $$,
  '42501',
  NULL,
  'an owner cannot create a feeding log for a reviewed but unpublished food'
);

SELECT throws_ok(
  $$
    INSERT INTO public.feeding_logs (cat_id, food_id, started_on)
    VALUES (-92001, -92999, '2026-07-23'::date)
  $$,
  '42501',
  NULL,
  'an owner cannot distinguish a missing food from a hidden draft'
);

SELECT throws_ok(
  $$
    UPDATE public.feeding_logs
    SET food_id = -92003
    WHERE cat_id = -92001
      AND food_id = -92002
  $$,
  '42501',
  NULL,
  'an owner cannot update a feeding log to reference a reviewed but unpublished food'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id IN (-92001, -92002, -92003)
  ),
  3::bigint,
  'service role can read published and private foods'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id = -92001
  ),
  1::bigint,
  'service role can read draft foods'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
