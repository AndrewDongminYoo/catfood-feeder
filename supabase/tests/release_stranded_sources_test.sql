BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(8);

SELECT has_function(
  'public',
  'release_stranded_food_sources',
  ARRAY['bigint[]']
);

SELECT is(
  has_function_privilege(
    'anon',
    'public.release_stranded_food_sources(bigint[])',
    'EXECUTE'
  ),
  false,
  'anon cannot release stranded sources'
);

SELECT is(
  has_function_privilege(
    'service_role',
    'public.release_stranded_food_sources(bigint[])',
    'EXECUTE'
  ),
  true,
  'service_role can release reviewed stranded sources'
);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-95001, 'pgTAP stranded brand', 'pgTAP stranded brand', 'pgTAP manufacturer');

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
  (-95001, -95001, 'stranded draft', null, null, null),
  (-95002, -95001, 'published source', now(), now(), 'legacy_human');

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
  (95001, -95001, 'manufacturer', 'https://example.test/stranded', 'fetch', 'fetched', now(), 'stranded', 'No evidence.'),
  (95002, -95001, 'manufacturer', 'https://example.test/nutrient', 'fetch', 'fetched', now(), 'nutrient', 'Protein 32%.'),
  (95003, -95001, 'manufacturer', 'https://example.test/ingredient', 'fetch', 'fetched', now(), 'ingredient', 'Chicken, turkey.'),
  (95004, -95002, 'manufacturer', 'https://example.test/published', 'fetch', 'fetched', now(), 'published', 'Published.');

INSERT INTO public.food_nutrient_evidence (
  food_id,
  nutrient_key,
  source_id,
  value,
  excerpt,
  captured_at
)
VALUES (-95001, 'protein_pct', 95002, 32, 'Protein 32%', now());

INSERT INTO public.food_ingredient_evidence (
  food_id,
  source_id,
  excerpt,
  applied_by_origin,
  captured_at
)
VALUES (-95001, 95003, 'Chicken, turkey', 'human', now());

SELECT is(
  (
    SELECT array_agg(released.source_id ORDER BY released.source_id)
    FROM public.release_stranded_food_sources(ARRAY[95001]::bigint [])
      AS released
  ),
  ARRAY[95001]::bigint[],
  'the RPC releases the exact reviewed stranded source'
);

SELECT is(
  (
    SELECT array_agg(id ORDER BY id)
    FROM public.food_sources
    WHERE id BETWEEN 95001 AND 95004
      AND is_current
  ),
  ARRAY[95002, 95003, 95004]::bigint[],
  'nutrient-backed, ingredient-backed, and published sources stay current'
);

SELECT throws_ok(
  $$SELECT public.release_stranded_food_sources(ARRAY[95002]::bigint [])$$,
  'CFRVW',
  'Reviewed source IDs are no longer stranded',
  'the RPC rejects a source that gained current nutrient evidence'
);

SELECT throws_ok(
  $$SELECT public.release_stranded_food_sources(ARRAY[95003]::bigint [])$$,
  'CFRVW',
  'Reviewed source IDs are no longer stranded',
  'the RPC rejects a source that gained current ingredient evidence'
);

SELECT throws_ok(
  $$SELECT public.release_stranded_food_sources(ARRAY[95004]::bigint [])$$,
  'CFRVW',
  'Reviewed source IDs are no longer stranded',
  'the RPC rejects a source whose food is published'
);

SELECT * FROM finish();
ROLLBACK;
