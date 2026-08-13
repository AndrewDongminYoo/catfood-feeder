BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(21);

SELECT has_column('public', 'foods', 'published_at', 'foods has published_at');
SELECT has_column('public', 'foods', 'published_by', 'foods has published_by');
SELECT has_column(
  'public',
  'foods',
  'verification_method',
  'foods has verification_method'
);
SELECT has_function(
  'public',
  'publish_food_draft',
  ARRAY['bigint', 'uuid', 'timestamp with time zone', 'jsonb']
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS proc
    CROSS JOIN LATERAL aclexplode(
      coalesce(proc.proacl, acldefault('f', proc.proowner))
    ) AS acl
    WHERE proc.oid = 'public.publish_food_draft(bigint,uuid,timestamp with time zone,jsonb)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  0::bigint,
  'PUBLIC has no EXECUTE ACL item for publish_food_draft'
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.publish_food_draft(bigint,uuid,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  false,
  'anon cannot execute publish_food_draft'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.publish_food_draft(bigint,uuid,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  false,
  'authenticated cannot execute publish_food_draft'
);

SELECT is(
  has_function_privilege(
    'service_role',
    'public.publish_food_draft(bigint,uuid,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  true,
  'service_role can execute publish_food_draft'
);

INSERT INTO auth.users (id)
VALUES ('00000000-0000-0000-0000-000000093001'::uuid);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-93001, 'pgTAP transition brand', 'pgTAP transition brand', 'pgTAP manufacturer');

INSERT INTO public.foods (
  id,
  brand_id,
  product_name,
  protein_pct,
  fat_pct,
  updated_at,
  data_verified_at,
  published_at,
  published_by,
  verification_method
)
OVERRIDING SYSTEM VALUE
VALUES
  (
    -93001,
    -93001,
    'fully evidenced draft',
    32,
    18,
    '2026-08-05 09:00:00+00'::timestamptz,
    null,
    null,
    null,
    null
  ),
  (
    -93002,
    -93001,
    'mismatched evidence draft',
    31,
    null,
    '2026-08-05 09:00:00+00'::timestamptz,
    null,
    null,
    null,
    null
  ),
  (
    -93003,
    -93001,
    'no evidence draft',
    29,
    null,
    '2026-08-05 09:00:00+00'::timestamptz,
    null,
    null,
    null,
    null
  ),
  (
    -93004,
    -93001,
    'stale draft',
    28,
    null,
    '2026-08-05 09:00:00+00'::timestamptz,
    null,
    null,
    null,
    null
  ),
  (
    -93005,
    -93001,
    'already published',
    30,
    null,
    '2026-08-05 09:00:00+00'::timestamptz,
    '2026-08-05 08:00:00+00'::timestamptz,
    '2026-08-05 08:00:00+00'::timestamptz,
    '00000000-0000-0000-0000-000000093001'::uuid,
    'human'
  ),
  (
    -93006,
    -93001,
    'missing evidence draft',
    27,
    15,
    '2026-08-05 09:00:00+00'::timestamptz,
    null,
    null,
    null,
    null
  );

INSERT INTO public.food_sources (
  id,
  food_id,
  kind,
  url,
  capture_method,
  fetch_status,
  captured_at,
  content_hash,
  captured_text
)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'manufacturer', 'https://example.test/fully-evidenced', 'fetch', 'fetched', now(), 'fully-evidenced', 'Protein 32%. Fat 18%.'),
  (-93002, -93002, 'manufacturer', 'https://example.test/mismatch', 'fetch', 'fetched', now(), 'mismatch', 'Protein 30%.'),
  (-93004, -93004, 'manufacturer', 'https://example.test/stale', 'fetch', 'fetched', now(), 'stale', 'Protein 28%.'),
  (-93006, -93006, 'manufacturer', 'https://example.test/missing', 'fetch', 'fetched', now(), 'missing', 'Protein 27%.');

INSERT INTO public.food_nutrient_evidence (
  food_id,
  nutrient_key,
  source_id,
  value,
  excerpt,
  captured_at
)
VALUES
  (-93001, 'protein_pct', -93001, 32, 'Protein 32%', now()),
  (-93001, 'fat_pct', -93001, 18, 'Fat 18%', now()),
  (-93002, 'protein_pct', -93002, 30, 'Protein 30%', now()),
  (-93004, 'protein_pct', -93004, 28, 'Protein 28%', now()),
  (-93006, 'protein_pct', -93006, 27, 'Protein 27%', now());

SELECT is(
  (
    public.publish_food_draft(
      -93001,
      '00000000-0000-0000-0000-000000093001'::uuid,
      '2026-08-05 09:00:00+00'::timestamptz,
      '{"carbPct":25,"carbIsEstimated":false,"energyPPct":33.7,"energyFPct":42.7,"energyCPct":23.6,"nutrientSources":{"protein_pct":"manufacturer","fat_pct":"manufacturer","carb_pct":"derived","energy_p_pct":"derived","energy_f_pct":"derived","energy_c_pct":"derived"}}'::jsonb
    ) ->> 'status'
  ),
  'published',
  'a fully evidenced draft is published'
);

SELECT ok(
  (
    SELECT published_at IS NOT null
      AND data_verified_at = published_at
      AND published_by = '00000000-0000-0000-0000-000000093001'::uuid
      AND verification_method = 'human'
    FROM public.foods
    WHERE id = -93001
  ),
  'publication records one timestamp, the actor, and the human method'
);

SELECT ok(
  (
    SELECT carb_pct = 25
      AND carb_is_estimated = false
      AND energy_p_pct = 33.7
      AND energy_f_pct = 42.7
      AND energy_c_pct = 23.6
      AND nutrient_sources ->> 'carb_pct' = 'derived'
    FROM public.foods
    WHERE id = -93001
  ),
  'publication persists server-computed derived fields and provenance'
);

SELECT is(
  (
    public.publish_food_draft(
      -93002,
      '00000000-0000-0000-0000-000000093001'::uuid,
      '2026-08-05 09:00:00+00'::timestamptz,
      '{"carbPct":null,"carbIsEstimated":false,"energyPPct":null,"energyFPct":null,"energyCPct":null,"nutrientSources":{"protein_pct":"manufacturer"}}'::jsonb
    ) ->> 'status'
  ),
  'evidence_mismatch',
  'a stored nutrient that differs from current evidence blocks publication'
);

SELECT is(
  (
    SELECT published_at IS null AND verification_method IS null
    FROM public.foods
    WHERE id = -93002
  ),
  true,
  'an evidence mismatch leaves the draft private'
);

SELECT is(
  (
    public.publish_food_draft(
      -93003,
      '00000000-0000-0000-0000-000000093001'::uuid,
      '2026-08-05 09:00:00+00'::timestamptz,
      '{"carbPct":null,"carbIsEstimated":false,"energyPPct":null,"energyFPct":null,"energyCPct":null,"nutrientSources":{"protein_pct":"manufacturer"}}'::jsonb
    ) ->> 'status'
  ),
  'no_evidence',
  'a draft without retained evidence cannot be published'
);

SELECT is(
  (
    SELECT published_at IS null AND verification_method IS null
    FROM public.foods
    WHERE id = -93003
  ),
  true,
  'a draft without evidence remains private'
);

SELECT is(
  (
    public.publish_food_draft(
      -93004,
      '00000000-0000-0000-0000-000000093001'::uuid,
      '2026-08-05 08:59:59+00'::timestamptz,
      '{"carbPct":null,"carbIsEstimated":false,"energyPPct":null,"energyFPct":null,"energyCPct":null,"nutrientSources":{"protein_pct":"manufacturer"}}'::jsonb
    ) ->> 'status'
  ),
  'stale',
  'a stale expected timestamp blocks publication'
);

SELECT is(
  (
    SELECT published_at IS null AND verification_method IS null
    FROM public.foods
    WHERE id = -93004
  ),
  true,
  'a stale publication attempt leaves the draft private'
);

SELECT is(
  (
    public.publish_food_draft(
      -93005,
      '00000000-0000-0000-0000-000000093001'::uuid,
      '2026-08-05 09:00:00+00'::timestamptz,
      '{"carbPct":null,"carbIsEstimated":false,"energyPPct":null,"energyFPct":null,"energyCPct":null,"nutrientSources":{"protein_pct":"manufacturer"}}'::jsonb
    ) ->> 'status'
  ),
  'already_published',
  'an already-published row is idempotently rejected'
);

SELECT is(
  (
    public.publish_food_draft(
      -93006,
      '00000000-0000-0000-0000-000000093001'::uuid,
      '2026-08-05 09:00:00+00'::timestamptz,
      '{"carbPct":null,"carbIsEstimated":false,"energyPPct":null,"energyFPct":null,"energyCPct":null,"nutrientSources":{"protein_pct":"manufacturer","fat_pct":"manufacturer"}}'::jsonb
    ) ->> 'status'
  ),
  'missing_evidence',
  'a populated nutrient without current evidence blocks publication'
);

SELECT is(
  (
    SELECT published_at IS null AND verification_method IS null
    FROM public.foods
    WHERE id = -93006
  ),
  true,
  'a missing-evidence result leaves the draft private'
);

SELECT is(
  (
    public.publish_food_draft(
      -93999,
      '00000000-0000-0000-0000-000000093001'::uuid,
      '2026-08-05 09:00:00+00'::timestamptz,
      '{"carbPct":null,"carbIsEstimated":false,"energyPPct":null,"energyFPct":null,"energyCPct":null,"nutrientSources":{}}'::jsonb
    ) ->> 'status'
  ),
  'not_found',
  'a missing food returns not_found'
);

SELECT * FROM finish();
ROLLBACK;
