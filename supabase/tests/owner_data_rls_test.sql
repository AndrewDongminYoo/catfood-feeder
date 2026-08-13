BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(13);

INSERT INTO auth.users (id)
VALUES
  ('00000000-0000-0000-0000-000000097001'::uuid),
  ('00000000-0000-0000-0000-000000097002'::uuid);

INSERT INTO public.brands (id, name, ko_name)
OVERRIDING SYSTEM VALUE
VALUES (-97001, 'pgTAP owner RLS brand', 'pgTAP owner RLS brand');

INSERT INTO public.foods (
  id,
  brand_id,
  product_name,
  data_verified_at,
  published_at,
  verification_method
)
OVERRIDING SYSTEM VALUE
VALUES (
  -97001,
  -97001,
  'pgTAP owner RLS food',
  '2026-08-13 00:00:00+00'::timestamptz,
  '2026-08-13 00:00:00+00'::timestamptz,
  'legacy_human'
);

INSERT INTO public.cats (id, owner_id, name)
OVERRIDING SYSTEM VALUE
VALUES
  (-97001, '00000000-0000-0000-0000-000000097001'::uuid, 'owner cat'),
  (-97002, '00000000-0000-0000-0000-000000097002'::uuid, 'other cat');

INSERT INTO public.feeding_logs (id, cat_id, food_id, started_on)
OVERRIDING SYSTEM VALUE
VALUES
  (-97001, -97001, -97001, '2026-08-12'::date),
  (-97002, -97002, -97001, '2026-08-12'::date);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000097001',
  TRUE
);
SET LOCAL ROLE authenticated;

SELECT is(
  has_table_privilege('authenticated', 'public.cats', 'SELECT'),
  true,
  'authenticated reaches the cats RLS policy'
);

SELECT is(
  has_table_privilege('authenticated', 'public.feeding_logs', 'SELECT'),
  true,
  'authenticated reaches the feeding-logs RLS policy'
);

SELECT is(
  (SELECT count(*) FROM public.cats WHERE id IN (-97001, -97002)),
  1::bigint,
  'an owner sees only their cat'
);

SELECT is(
  (SELECT count(*) FROM public.cats WHERE id = -97002),
  0::bigint,
  'an owner cannot read another user cat'
);

SELECT throws_ok(
  $$
    INSERT INTO public.cats (owner_id, name)
    VALUES ('00000000-0000-0000-0000-000000097002'::uuid, 'injected cat')
  $$,
  '42501',
  NULL,
  'an owner cannot create a cat for another user'
);

SELECT is_empty(
  $$
    UPDATE public.cats SET name = 'hijacked cat' WHERE id = -97002 RETURNING id
  $$,
  'an owner cannot update another user cat'
);

SELECT is_empty(
  $$
    DELETE FROM public.cats WHERE id = -97002 RETURNING id
  $$,
  'an owner cannot delete another user cat'
);

SELECT is(
  (SELECT count(*) FROM public.feeding_logs WHERE id IN (-97001, -97002)),
  1::bigint,
  'an owner sees only their feeding log'
);

SELECT is(
  (SELECT count(*) FROM public.feeding_logs WHERE id = -97002),
  0::bigint,
  'an owner cannot read another user feeding log'
);

SELECT throws_ok(
  $$
    INSERT INTO public.feeding_logs (cat_id, food_id, started_on)
    VALUES (-97002, -97001, '2026-08-13'::date)
  $$,
  '42501',
  NULL,
  'an owner cannot create a feeding log for another user cat'
);

SELECT throws_ok(
  $$
    UPDATE public.feeding_logs SET cat_id = -97002 WHERE id = -97001
  $$,
  '42501',
  NULL,
  'an owner cannot move their feeding log to another user cat'
);

SELECT is_empty(
  $$
    UPDATE public.feeding_logs SET note = 'hijacked log' WHERE id = -97002 RETURNING id
  $$,
  'an owner cannot update another user feeding log'
);

SELECT is_empty(
  $$
    DELETE FROM public.feeding_logs WHERE id = -97002 RETURNING id
  $$,
  'an owner cannot delete another user feeding log'
);

RESET ROLE;
SELECT * FROM finish(); -- noqa: AM04
ROLLBACK;
