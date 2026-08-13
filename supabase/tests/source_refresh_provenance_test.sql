BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(11);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-91001, 'pgTAP provenance brand', 'pgTAP provenance brand', 'pgTAP manufacturer');

INSERT INTO public.foods (
  id,
  brand_id,
  product_name,
  protein_pct,
  nutrient_sources,
  updated_at
)
OVERRIDING SYSTEM VALUE
VALUES (
  -91001,
  -91001,
  'identical refresh',
  1.234,
  '{}'::jsonb,
  '2026-07-21 00:00:00+00'::timestamptz
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
  captured_text,
  is_current
)
OVERRIDING SYSTEM VALUE
VALUES (
  -91001,
  -91001,
  'manufacturer',
  'https://example.test/identical-old',
  'fetch',
  'fetched',
  now() - interval '1 day',
  'identical-old',
  'Protein 1.234%',
  false
);

INSERT INTO public.food_nutrient_evidence (
  food_id,
  nutrient_key,
  source_id,
  value,
  excerpt,
  captured_at
)
VALUES (
  -91001,
  'protein_pct',
  -91001,
  1.234,
  'Protein 1.234%',
  now() - interval '1 day'
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
VALUES (
  -91002,
  -91001,
  'manufacturer',
  'https://example.test/identical-new',
  'fetch',
  'fetched',
  now(),
  'identical-new',
  'Protein 1.234%'
);

CREATE TEMP TABLE apply_results (
  scenario text PRIMARY KEY,
  result jsonb
);

INSERT INTO apply_results (scenario, result)
SELECT
  'identical' AS scenario,
  to_jsonb(public.apply_food_evidence_draft(
    -91001,
    jsonb_build_array(jsonb_build_object(
      'nutrient_key', 'protein_pct',
      'source_id', -91002,
      'value', 1.234,
      'excerpt', 'Protein 1.234%'
    ))
  )) AS result;

SELECT is(
  (
    SELECT result
    FROM apply_results
    WHERE scenario = 'identical'
  ),
  jsonb_build_array(jsonb_build_object(
    'nutrient_key', 'protein_pct',
    'source_id', -91002,
    'value', 1.234,
    'excerpt', 'Protein 1.234%',
    'status', 'applied'
  )),
  'an identical same-source refresh reports applied'
);

SELECT is(
  (
    SELECT protein_pct
    FROM public.foods
    WHERE id = -91001
  ),
  1.23::numeric,
  'an identical same-source refresh preserves the nutrient value'
);

SELECT is(
  (
    SELECT source_id
    FROM public.food_nutrient_evidence
    WHERE food_id = -91001
      AND nutrient_key = 'protein_pct'
      AND is_current
  ),
  -91002::bigint,
  'an identical same-source refresh points current evidence at the new capture'
);

SELECT is(
  (
    SELECT nutrient_sources
    FROM public.foods
    WHERE id = -91001
  ),
  '{}'::jsonb,
  'an identical same-source refresh preserves nutrient source tags'
);

SELECT is(
  (
    SELECT updated_at
    FROM public.foods
    WHERE id = -91001
  ),
  '2026-07-21 00:00:00+00'::timestamptz,
  'an identical same-source refresh does not touch the food timestamp'
);

UPDATE public.food_sources
SET is_current = false
WHERE id = -91002;

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
VALUES (
  -91003,
  -91001,
  'manufacturer',
  'https://example.test/conflict-new',
  'fetch',
  'fetched',
  now(),
  'conflict-new',
  'Protein 1.235%'
);

INSERT INTO apply_results (scenario, result)
SELECT
  'conflict' AS scenario,
  to_jsonb(public.apply_food_evidence_draft(
    -91001,
    jsonb_build_array(jsonb_build_object(
      'nutrient_key', 'protein_pct',
      'source_id', -91003,
      'value', 1.235,
      'excerpt', 'Protein 1.235%'
    ))
  )) AS result;

SELECT is(
  (
    SELECT result
    FROM apply_results
    WHERE scenario = 'conflict'
  ),
  jsonb_build_array(jsonb_build_object(
    'nutrient_key', 'protein_pct',
    'source_id', -91003,
    'value', 1.235,
    'excerpt', 'Protein 1.235%',
    'status', 'conflict'
  )),
  'a changed same-source refresh reports conflict'
);

SELECT is(
  (
    SELECT protein_pct
    FROM public.foods
    WHERE id = -91001
  ),
  1.23::numeric,
  'a changed same-source refresh preserves the stored value'
);

SELECT is(
  (
    SELECT source_id
    FROM public.food_nutrient_evidence
    WHERE food_id = -91001
      AND nutrient_key = 'protein_pct'
      AND is_current
  ),
  -91002::bigint,
  'a changed same-source refresh preserves existing evidence'
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
VALUES (
  -91004,
  -91001,
  'kr_label',
  'https://example.test/overlap-kr-label',
  'manual',
  'fetched',
  now(),
  'overlap-kr-label',
  '조단백질 1.24% 이상'
);

INSERT INTO apply_results (scenario, result)
SELECT
  'overlap' AS scenario,
  to_jsonb(public.apply_food_evidence_draft(
    -91001,
    jsonb_build_array(jsonb_build_object(
      'nutrient_key', 'protein_pct',
      'source_id', -91004,
      'value', 1.24,
      'excerpt', '조단백질 1.24% 이상'
    ))
  )) AS result;

SELECT is(
  (
    SELECT result
    FROM apply_results
    WHERE scenario = 'overlap'
  ),
  jsonb_build_array(jsonb_build_object(
    'nutrient_key', 'protein_pct',
    'source_id', -91004,
    'value', 1.24,
    'excerpt', '조단백질 1.24% 이상',
    'status', 'skipped'
  )),
  'a different-source overlap reports skipped'
);

SELECT is(
  (
    SELECT protein_pct
    FROM public.foods
    WHERE id = -91001
  ),
  1.23::numeric,
  'a different-source overlap preserves the stored value'
);

SELECT is(
  (
    SELECT source_id
    FROM public.food_nutrient_evidence
    WHERE food_id = -91001
      AND nutrient_key = 'protein_pct'
      AND is_current
  ),
  -91002::bigint,
  'a different-source overlap preserves existing evidence'
);

SELECT * FROM finish();
ROLLBACK;
