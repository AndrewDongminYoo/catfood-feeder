BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(11);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-93001, 'pgTAP research brand', 'pgTAP research brand', 'pgTAP manufacturer');

INSERT INTO public.foods (id, brand_id, product_name)
OVERRIDING SYSTEM VALUE
VALUES (-93001, -93001, 'pgTAP research skeleton');

INSERT INTO public.food_research_runs (
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
VALUES (
  -93001,
  'pgTAP agent',
  'pgTAP model',
  '1',
  '1',
  '{}'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'rejected'
);

-- terminal status 는 CHECK 로 고정돼 있다. 라우트가 쓰는 값이 빠져 있으면
-- 그 경로는 프로덕션에서만 23514 로 죽는다 — vitest 는 원장을 mock 하므로 못 잡는다.
SELECT lives_ok(
  $$
    INSERT INTO public.food_research_runs (
      food_id, agent_name, agent_model, prompt_version, schema_version,
      proposal, captures, evidence_results, status
    )
    SELECT -93001, 'pgTAP agent', 'pgTAP model', '1', '1',
           '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, status
    FROM unnest(ARRAY[
      'applied', 'rejected', 'capture_failed', 'claim_conflict', 'errored'
    ]) AS status
  $$,
  'every terminal run status the route can emit satisfies the CHECK constraint'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.food_research_runs'::regclass
  ),
  'row level security is enabled on food_research_runs'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'food_research_runs'
  ),
  0::bigint,
  'food_research_runs has no policy, so no API role can read it through RLS'
);

SELECT is(
  has_table_privilege('anon', 'public.food_research_runs', 'SELECT'),
  false,
  'anon has no SELECT privilege on food_research_runs'
);

SELECT is(
  has_table_privilege('authenticated', 'public.food_research_runs', 'SELECT'),
  false,
  'authenticated has no SELECT privilege on food_research_runs'
);

SELECT is(
  has_table_privilege('service_role', 'public.food_research_runs', 'SELECT'),
  true,
  'service_role can read the research ledger'
);

SELECT is(
  has_table_privilege('service_role', 'public.food_research_runs', 'INSERT'),
  true,
  'service_role can append to the research ledger'
);

SELECT is(
  has_column_privilege('service_role', 'public.food_research_runs', 'status', 'UPDATE'),
  true,
  'service_role can update transcript status'
);

SELECT is(
  has_column_privilege('service_role', 'public.food_research_runs', 'proposal', 'UPDATE'),
  false,
  'service_role cannot rewrite a research proposal'
);

-- 권한이 없어서 막히는 것과 RLS가 막는 것은 다르다. 테이블 권한을 트랜잭션
-- 안에서 일부러 열어 준 뒤에도 행이 보이지 않아야 RLS를 증명한 것이다.
-- (로컬 `supabase start`는 클라우드와 달리 기본 권한을 부여하지 않는다.)
GRANT SELECT ON public.food_research_runs TO anon, authenticated;

SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*) FROM public.food_research_runs),
  0::bigint,
  'anon sees no research runs even with an explicit SELECT grant'
);

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*) FROM public.food_research_runs),
  0::bigint,
  'authenticated sees no research runs even with an explicit SELECT grant'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
