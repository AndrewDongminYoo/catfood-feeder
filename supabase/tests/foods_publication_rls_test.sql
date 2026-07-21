BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(6);

INSERT INTO public.brands (id, name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-92001, 'pgTAP publication brand', 'pgTAP manufacturer');

INSERT INTO public.foods (
  id,
  brand_id,
  product_name,
  data_verified_at
)
OVERRIDING SYSTEM VALUE
VALUES
  (-92001, -92001, 'pgTAP draft food', NULL),
  (-92002, -92001, 'pgTAP verified food', '2026-07-21 00:00:00+00'::timestamptz);

SET LOCAL ROLE anon;

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id IN (-92001, -92002)
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

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id IN (-92001, -92002)
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

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT is(
  (
    SELECT count(*)
    FROM public.foods
    WHERE id IN (-92001, -92002)
  ),
  2::bigint,
  'service role can read verified and draft foods'
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
