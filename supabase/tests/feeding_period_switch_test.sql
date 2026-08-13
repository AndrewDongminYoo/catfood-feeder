BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(16);

SELECT has_function(
  'public',
  'switch_current_feeding',
  ARRAY['bigint', 'bigint', 'date', 'text']
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS function_record
    CROSS JOIN LATERAL aclexplode(
      coalesce(
        function_record.proacl,
        acldefault('f', function_record.proowner)
      )
    ) AS acl
    WHERE function_record.oid = 'public.switch_current_feeding(bigint,bigint,date,text)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  0::bigint,
  'PUBLIC has no EXECUTE ACL item for switch_current_feeding'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.switch_current_feeding(bigint,bigint,date,text)',
    'EXECUTE'
  ),
  false,
  'anon cannot execute switch_current_feeding'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.switch_current_feeding(bigint,bigint,date,text)',
    'EXECUTE'
  ),
  true,
  'authenticated can execute switch_current_feeding'
);

SELECT is(
  has_function_privilege(
    'service_role',
    'public.switch_current_feeding(bigint,bigint,date,text)',
    'EXECUTE'
  ),
  false,
  'service role cannot execute owner feeding transitions'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'feeding_logs'
      AND indexname = 'feeding_logs_one_open_per_cat_idx'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%WHERE (ended_on IS NULL)'
  ),
  1::bigint,
  'feeding logs enforce one open period per cat'
);

INSERT INTO auth.users (id)
VALUES
  ('00000000-0000-0000-0000-000000098001'::uuid),
  ('00000000-0000-0000-0000-000000098002'::uuid);

INSERT INTO public.brands (id, name, ko_name)
OVERRIDING SYSTEM VALUE
VALUES (-98001, 'pgTAP feeding brand', 'pgTAP feeding brand');

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
  (
    -98001,
    -98001,
    'pgTAP current food',
    '2026-08-01 00:00:00+00'::timestamptz,
    '2026-08-01 00:00:00+00'::timestamptz,
    'legacy_human'
  ),
  (
    -98002,
    -98001,
    'pgTAP next food',
    '2026-08-01 00:00:00+00'::timestamptz,
    '2026-08-01 00:00:00+00'::timestamptz,
    'legacy_human'
  );

INSERT INTO public.cats (id, owner_id, name)
OVERRIDING SYSTEM VALUE
VALUES
  (-98001, '00000000-0000-0000-0000-000000098001'::uuid, 'owner cat'),
  (-98002, '00000000-0000-0000-0000-000000098002'::uuid, 'other cat');

INSERT INTO public.feeding_logs (id, cat_id, food_id, started_on, note)
OVERRIDING SYSTEM VALUE
VALUES (-98001, -98001, -98001, '2026-08-01'::date, 'previous food');

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000098001',
  TRUE
);
SET LOCAL ROLE authenticated;

SELECT ok(
  public.switch_current_feeding(
    -98001,
    -98002,
    '2026-08-10'::date,
    'transitioned food'
  ) > 0,
  'an owner can atomically switch the current food'
);

SELECT is(
  (SELECT ended_on FROM public.feeding_logs WHERE id = -98001),
  '2026-08-10'::date,
  'switching closes the previous period on the new start date'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.feeding_logs
    WHERE cat_id = -98001
      AND food_id = -98002
      AND ended_on IS NULL
  ),
  1::bigint,
  'switching leaves exactly one new current period'
);

SELECT is(
  (
    SELECT note
    FROM public.feeding_logs
    WHERE cat_id = -98001
      AND food_id = -98002
      AND ended_on IS NULL
  ),
  'transitioned food'::text,
  'switching preserves the new period note'
);

SELECT throws_ok(
  $$
    SELECT public.switch_current_feeding(
      -98001,
      -98001,
      '2026-08-09'::date,
      NULL
    )
  $$,
  '22023',
  NULL,
  'a switch cannot predate the current period'
);

SELECT throws_ok(
  $$
    SELECT public.switch_current_feeding(
      -98002,
      -98001,
      '2026-08-10'::date,
      NULL
    )
  $$,
  '42501',
  NULL,
  'an owner cannot switch another user cat'
);

SELECT throws_ok(
  $$
    INSERT INTO public.feeding_logs (cat_id, food_id, started_on)
    VALUES (-98001, -98001, '2026-08-11'::date)
  $$,
  '23505',
  NULL,
  'direct writes cannot create a second open period'
);

SELECT ok(
  public.switch_current_feeding(
    -98001,
    -98001,
    '2026-08-20'::date,
    'switched again'
  ) > 0,
  'an owner can switch the current food repeatedly'
);

SELECT is(
  (
    SELECT ended_on
    FROM public.feeding_logs
    WHERE cat_id = -98001
      AND food_id = -98002
      AND started_on = '2026-08-10'::date
  ),
  '2026-08-20'::date,
  'a repeated switch closes the replacement period'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.feeding_logs
    WHERE cat_id = -98001
      AND ended_on IS NULL
  ),
  1::bigint,
  'a repeated switch still leaves exactly one current period'
);

RESET ROLE;
SELECT * FROM finish(); -- noqa: AM04
ROLLBACK;
