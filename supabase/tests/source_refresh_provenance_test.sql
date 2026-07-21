BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(9);

INSERT INTO public.brands (id, name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-91001, 'pgTAP provenance brand', 'pgTAP manufacturer');

INSERT INTO public.foods (
  id,
  brand_id,
  product_name,
  protein_pct,
  nutrient_sources
)
OVERRIDING SYSTEM VALUE
VALUES (
  -91001,
  -91001,
  'identical refresh',
  10,
  '{"protein_pct":"manufacturer"}'::jsonb
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
  'Protein 10%',
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
  10,
  'Protein 10%',
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
  'Protein 10%'
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
      'value', 10,
      'excerpt', 'Protein 10%'
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
    'value', 10,
    'excerpt', 'Protein 10%',
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
  10::numeric,
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
  'Protein 12%'
);

INSERT INTO apply_results (scenario, result)
SELECT
  'conflict' AS scenario,
  to_jsonb(public.apply_food_evidence_draft(
    -91001,
    jsonb_build_array(jsonb_build_object(
      'nutrient_key', 'protein_pct',
      'source_id', -91003,
      'value', 12,
      'excerpt', 'Protein 12%'
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
    'value', 12,
    'excerpt', 'Protein 12%',
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
  10::numeric,
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
  '조단백질 11% 이상'
);

INSERT INTO apply_results (scenario, result)
SELECT
  'overlap' AS scenario,
  to_jsonb(public.apply_food_evidence_draft(
    -91001,
    jsonb_build_array(jsonb_build_object(
      'nutrient_key', 'protein_pct',
      'source_id', -91004,
      'value', 11,
      'excerpt', '조단백질 11% 이상'
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
    'value', 11,
    'excerpt', '조단백질 11% 이상',
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
  10::numeric,
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
