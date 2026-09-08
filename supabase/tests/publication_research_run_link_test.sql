BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(7);

SELECT has_table(
  'public',
  'food_publication_research_runs',
  'publication research-run links are retained'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.food_publication_research_runs'::regclass
  ),
  'publication research-run links have RLS enabled'
);

SELECT is(
  has_table_privilege('anon', 'public.food_publication_research_runs', 'SELECT'),
  false,
  'anon cannot read publication research-run links'
);

SELECT is(
  has_table_privilege('service_role', 'public.food_publication_research_runs', 'SELECT'),
  true,
  'service_role can read publication research-run links'
);

INSERT INTO auth.users (id)
VALUES ('00000000-0000-0000-0000-000000094001'::uuid);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-94001, 'pgTAP run-link brand', 'pgTAP run-link brand', 'pgTAP manufacturer');

INSERT INTO public.foods (id, brand_id, product_name, protein_pct)
OVERRIDING SYSTEM VALUE
VALUES (-94001, -94001, 'run-linked draft', 32);

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
VALUES
  (94001, -94001, 'manufacturer', 'https://example.test/run-link', 'fetch', 'fetched', now(), 'run-link', 'Protein 32%.', true),
  (94002, -94001, 'kr_label', 'https://example.test/second-link', 'fetch', 'fetched', now(), 'second-link', 'Fat 12%.', true),
  (94003, -94001, 'manufacturer', 'https://example.test/retired', 'fetch', 'fetched', now(), 'retired', 'Fiber 4%.', false);

INSERT INTO public.food_nutrient_evidence (
  food_id,
  nutrient_key,
  source_id,
  value,
  excerpt,
  captured_at
)
VALUES
  (-94001, 'protein_pct', 94001, 32, 'Protein 32%', now()),
  (-94001, 'fat_pct', 94002, 12, 'Fat 12%', now());

INSERT INTO public.food_research_runs (
  id,
  food_id,
  agent_name,
  agent_model,
  prompt_version,
  schema_version,
  proposal,
  captures,
  evidence_results,
  status
)
OVERRIDING SYSTEM VALUE
VALUES
  (-94001, -94001, 'pgTAP agent', 'pgTAP model', '1', '1', '{}'::jsonb, '[{"sourceId":94001,"url":"https://example.test/run-link"}]'::jsonb, '[{"sourceUrl":"https://example.test/run-link","status":"applied"}]'::jsonb, 'applied'),
  (-94002, -94001, 'pgTAP agent', 'pgTAP model', '1', '1', '{}'::jsonb, '[{"sourceId":94002,"url":"https://example.test/second-link"}]'::jsonb, '[{"sourceUrl":"https://example.test/second-link","status":"applied"}]'::jsonb, 'applied'),
  (-94003, -94001, 'pgTAP agent', 'pgTAP model', '1', '1', '{}'::jsonb, '[{"sourceId":94002,"url":"https://example.test/second-link"},{"sourceId":94003,"url":"https://example.test/retired"}]'::jsonb, '[{"sourceUrl":"https://example.test/second-link","status":"unverified"},{"sourceUrl":"https://example.test/retired","status":"applied"}]'::jsonb, 'applied');

SELECT is(
  (
    SELECT array_agg(linked.research_run_id ORDER BY linked.research_run_id)
    FROM public.food_publication_research_run_ids(-94001) AS linked
  ),
  ARRAY[-94002, -94001]::bigint[],
  'shared selection excludes a run that did not apply the current evidence source'
);

UPDATE public.foods
SET data_verified_at = now(),
    published_at = now(),
    published_by = '00000000-0000-0000-0000-000000094001'::uuid,
    verification_method = 'human'
WHERE id = -94001;

SELECT is(
  (
    SELECT array_agg(research_run_id ORDER BY research_run_id)
    FROM public.food_publication_research_runs
    WHERE food_id = -94001
  ),
  ARRAY[-94002, -94001]::bigint[],
  'publication links only runs that applied evidence from a current source'
);

SELECT is(
  (
    SELECT bool_and(link.published_at = food.published_at)
    FROM public.food_publication_research_runs AS link
    JOIN public.foods AS food ON food.id = link.food_id
    WHERE link.food_id = -94001
  ),
  true,
  'the link retains the publication timestamp'
);

SELECT * FROM finish();
ROLLBACK;
