BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(39);

SELECT table_privs_are('public', 'brands', 'anon', ARRAY['SELECT']::name[], 'anon can read brands');
SELECT table_privs_are('public', 'foods', 'anon', ARRAY['SELECT']::name[], 'anon can read foods');
SELECT table_privs_are('public', 'recalls', 'anon', ARRAY['SELECT']::name[], 'anon can read recalls');
SELECT table_privs_are('public', 'prices', 'anon', ARRAY['SELECT']::name[], 'anon can read prices');
SELECT table_privs_are('public', 'cats', 'anon', ARRAY[]::name[], 'anon cannot reach cats');
SELECT table_privs_are('public', 'feeding_logs', 'anon', ARRAY[]::name[], 'anon cannot reach feeding logs');
SELECT table_privs_are('public', 'food_sources', 'anon', ARRAY[]::name[], 'anon cannot reach source ledger rows');
SELECT table_privs_are('public', 'food_nutrient_evidence', 'anon', ARRAY[]::name[], 'anon cannot reach evidence ledger rows');
SELECT table_privs_are('public', 'food_research_runs', 'anon', ARRAY[]::name[], 'anon cannot reach research runs');
SELECT table_privs_are('public', 'extraction_rate_limits', 'anon', ARRAY[]::name[], 'anon cannot reach extraction rate limits');

SELECT table_privs_are('public', 'brands', 'authenticated', ARRAY['SELECT']::name[], 'authenticated can read brands');
SELECT table_privs_are('public', 'foods', 'authenticated', ARRAY['SELECT']::name[], 'authenticated can read foods');
SELECT table_privs_are('public', 'recalls', 'authenticated', ARRAY['SELECT']::name[], 'authenticated can read recalls');
SELECT table_privs_are('public', 'prices', 'authenticated', ARRAY['SELECT']::name[], 'authenticated can read prices');
SELECT table_privs_are('public', 'cats', 'authenticated', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::name[], 'authenticated can manage owner-scoped cats');
SELECT table_privs_are('public', 'feeding_logs', 'authenticated', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::name[], 'authenticated can manage owner-scoped feeding logs');
SELECT table_privs_are('public', 'food_sources', 'authenticated', ARRAY[]::name[], 'authenticated cannot reach source ledger rows');
SELECT table_privs_are('public', 'food_nutrient_evidence', 'authenticated', ARRAY[]::name[], 'authenticated cannot reach evidence ledger rows');
SELECT table_privs_are('public', 'food_research_runs', 'authenticated', ARRAY[]::name[], 'authenticated cannot reach research runs');
SELECT table_privs_are('public', 'extraction_rate_limits', 'authenticated', ARRAY[]::name[], 'authenticated cannot reach extraction rate limits');

SELECT table_privs_are('public', 'brands', 'service_role', ARRAY['INSERT', 'SELECT', 'UPDATE']::name[], 'service role can curate brands');
SELECT table_privs_are('public', 'foods', 'service_role', ARRAY['INSERT', 'SELECT', 'UPDATE']::name[], 'service role can curate foods');
SELECT table_privs_are('public', 'recalls', 'service_role', ARRAY['INSERT', 'SELECT', 'UPDATE']::name[], 'service role can synchronize recalls');
SELECT table_privs_are('public', 'prices', 'service_role', ARRAY[]::name[], 'service role has no unused price-table access');
SELECT table_privs_are('public', 'cats', 'service_role', ARRAY[]::name[], 'service role has no owner-data cat access');
SELECT table_privs_are('public', 'feeding_logs', 'service_role', ARRAY[]::name[], 'service role has no owner-data feeding-log access');
SELECT table_privs_are('public', 'food_sources', 'service_role', ARRAY['INSERT', 'SELECT', 'UPDATE']::name[], 'service role can manage source ledger rows');
SELECT table_privs_are('public', 'food_nutrient_evidence', 'service_role', ARRAY['SELECT']::name[], 'service role can inspect evidence ledger rows');
SELECT table_privs_are('public', 'food_research_runs', 'service_role', ARRAY['INSERT', 'SELECT']::name[], 'service role can append and read research runs');
SELECT table_privs_are('public', 'extraction_rate_limits', 'service_role', ARRAY[]::name[], 'service role reaches rate limits only through the RPC');

SELECT column_privs_are('public', 'food_research_runs', 'status', 'service_role', ARRAY['INSERT', 'SELECT', 'UPDATE']::name[], 'service role can update research-run status');
SELECT column_privs_are('public', 'food_research_runs', 'proposal', 'service_role', ARRAY['INSERT', 'SELECT']::name[], 'service role cannot rewrite research proposals');

SELECT sequence_privs_are('public', 'cats_id_seq', 'authenticated', ARRAY['USAGE']::name[], 'authenticated can allocate cat IDs');
SELECT sequence_privs_are('public', 'feeding_logs_id_seq', 'authenticated', ARRAY['USAGE']::name[], 'authenticated can allocate feeding-log IDs');
SELECT sequence_privs_are('public', 'brands_id_seq', 'service_role', ARRAY['USAGE']::name[], 'service role can allocate brand IDs');
SELECT sequence_privs_are('public', 'foods_id_seq', 'service_role', ARRAY['USAGE']::name[], 'service role can allocate food IDs');
SELECT sequence_privs_are('public', 'recalls_id_seq', 'service_role', ARRAY['USAGE']::name[], 'service role can allocate recall IDs');
SELECT sequence_privs_are('public', 'food_sources_id_seq', 'service_role', ARRAY['USAGE']::name[], 'service role can allocate source IDs');
SELECT sequence_privs_are('public', 'food_research_runs_id_seq', 'service_role', ARRAY['USAGE']::name[], 'service role can allocate research-run IDs');

SELECT * FROM finish(); -- noqa: AM04
ROLLBACK;
