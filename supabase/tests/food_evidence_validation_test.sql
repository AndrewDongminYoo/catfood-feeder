BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(18);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-92001, 'pgTAP evidence brand', 'pgTAP evidence brand', 'pgTAP manufacturer');

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
  'Crude protein 37%. Invalid claim: Crude protein 101%. Unsupported fraction: Crude protein ½%. Ambiguous claim: Crude protein 37%, crude fat 99%. Invalid comma: Calcium 1,2%. Repeated comma: Calcium 1,,2%. Trailing comma: Calcium 1,%. Leading comma: Calcium ,1%. Repeated trailing comma: Calcium 1,,%. Repeated dot: Calcium ..1%. Unsafe integer: Calcium 9007199254740993%. Rounded fraction: Calcium 0.99999999999999999%. Rounded safe integer: Calcium 9007199254740991.4%. Small decimal: Calcium 0.0000001%. Small leading decimal: Phosphorus .0000001%. Leading decimal: Crude protein .7%. Label punctuation: Crude protein min.30%. Metabolizable energy 3,850 kcal/kg.'
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

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":12,"excerpt":"Calcium 1,2%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects invalid decimal-comma grouping'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":12,"excerpt":"Calcium 1,,2%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects repeated comma grouping'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":1,"excerpt":"Calcium 1,%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects trailing comma grouping'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":1,"excerpt":"Calcium ,1%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects leading comma grouping'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":1,"excerpt":"Calcium 1,,%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects repeated trailing comma grouping'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":9007199254740992,"excerpt":"Calcium 9007199254740993%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects numeric evidence outside the JavaScript safe-integer range'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":0.1,"excerpt":"Calcium ..1%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects repeated decimal points'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":1,"excerpt":"Calcium 0.99999999999999999%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects a decimal that would round to the submitted value'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":9007199254740991,"excerpt":"Calcium 9007199254740991.4%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects a near-limit decimal that would round to the submitted value'
);

SELECT lives_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"calcium_pct","source_id":-92001,"value":0.0000001,"excerpt":"Calcium 0.0000001%"}]'::jsonb
  )$$,
  'accepts a small decimal value'
);

SELECT lives_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"phosphorus_pct","source_id":-92001,"value":0.0000001,"excerpt":"Phosphorus .0000001%"}]'::jsonb
  )$$,
  'accepts a small leading-decimal value'
);

SELECT lives_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"kcal_per_kg","source_id":-92001,"value":3850,"excerpt":"Metabolizable energy 3,850 kcal/kg"}]'::jsonb
  )$$,
  'accepts a correctly grouped thousands value'
);

SELECT lives_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"protein_pct","source_id":-92001,"value":0.7,"excerpt":"Crude protein .7%"}]'::jsonb
  )$$,
  'accepts an unambiguous leading-decimal evidence value'
);

SELECT throws_ok(
  $$SELECT public.apply_food_evidence_draft(
    -92001,
    '[{"nutrient_key":"protein_pct","source_id":-92001,"value":0.3,"excerpt":"Crude protein min.30%"}]'::jsonb
  )$$,
  'Evidence value is absent from its excerpt',
  'rejects a leading decimal parsed from label punctuation'
);

SELECT * FROM finish();
ROLLBACK;
