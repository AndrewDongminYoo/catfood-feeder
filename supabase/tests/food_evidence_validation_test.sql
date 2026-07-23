BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(5);

INSERT INTO public.brands (id, name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-92001, 'pgTAP evidence brand', 'pgTAP manufacturer');

INSERT INTO public.foods (id, brand_id, product_name)
OVERRIDING SYSTEM VALUE
VALUES (-92001, -92001, 'evidence validation');

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
  -92001,
  -92001,
  'manufacturer',
  'https://example.test/evidence-validation',
  'fetch',
  'fetched',
  now(),
  'evidence-validation',
  'Crude protein 37%. Invalid claim: Crude protein 101%. Unsupported fraction: Crude protein ½%. Ambiguous claim: Crude protein 37%, crude fat 99%. Leading decimal: Crude protein .7%. Metabolizable energy 3,850 kcal/kg.'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"protein_pct","source_id":-92001,"value":99,"excerpt":"Crude protein 37%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects a value that does not occur in its evidence excerpt'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"protein_pct","source_id":-92001,"value":101,"excerpt":"Crude protein 101%"}]'::jsonb
  )$$,
  'Evidence values violate catalog domain rules',
  'rejects a literal evidence value that violates catalog domain rules'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"protein_pct","source_id":-92001,"value":1,"excerpt":"Crude protein ½%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects a Unicode fraction that normalizes into separate integer tokens'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"protein_pct","source_id":-92001,"value":99,"excerpt":"Crude protein 37%, crude fat 99%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects an ambiguous excerpt with multiple numeric claims'
);

SELECT lives_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"protein_pct","source_id":-92001,"value":0.7,"excerpt":"Crude protein .7%"}]'::jsonb
  )$$,
  'accepts an unambiguous leading-decimal evidence value'
);

SELECT * FROM finish();
ROLLBACK;
