BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(17);
GRANT SELECT ON public.foods TO anon, authenticated;
GRANT SELECT (id, food_id, kind, url, capture_method, captured_at) ON public.food_sources TO anon, authenticated;
INSERT INTO public.brands (id,name,ko_name,manufacturer) OVERRIDING SYSTEM VALUE VALUES (-98601,'Adequacy test','Adequacy test','Test manufacturer');
INSERT INTO public.foods (id,brand_id,product_name,published_at,data_verified_at,verification_method)
OVERRIDING SYSTEM VALUE VALUES
(-98601,-98601,'Example Cat Food','2026-08-01','2026-08-01','human'),
(-98602,-98601,'Private Cat Food',NULL,NULL,NULL);
INSERT INTO public.food_sources (id,food_id,kind,url,capture_method,fetch_status,captured_at,content_hash,captured_text)
OVERRIDING SYSTEM VALUE VALUES
(-98601,-98601,'manufacturer','https://example.test/cat','fetch','fetched','2026-08-08','hash1','Example Cat Food is formulated to meet the nutritional levels established by the AAFCO Cat Food Nutrient Profiles for all life stages.'),
(-98602,-98602,'manufacturer','https://example.test/private','fetch','fetched','2026-08-08','hash2','Private Cat Food is formulated to meet the nutritional levels established by the AAFCO Cat Food Nutrient Profiles for all life stages.');
CREATE FUNCTION pg_temp.apply_test(p_food bigint DEFAULT -98601,p_source bigint DEFAULT -98601,p_hash text DEFAULT 'hash1',p_name text DEFAULT 'Example Cat Food',p_statement text DEFAULT 'Example Cat Food is formulated to meet the nutritional levels established by the AAFCO Cat Food Nutrient Profiles for all life stages.') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.apply_food_adequacy_declaration(p_food,p_source,p_statement,p_name,p_hash,'automation'); $$;
SELECT is(pg_temp.apply_test()->>'status','applied','literal claim applies');
SELECT is(pg_temp.apply_test()->>'status','skipped','same claim is idempotent');
SELECT is((SELECT captured_at FROM public.food_adequacy_declarations WHERE food_id=-98601),'2026-08-08'::timestamptz,'original capture date preserved');
SELECT is((SELECT applied_by_origin FROM public.food_adequacy_declarations WHERE food_id=-98601),'automation','agent never receives a human stamp');
SELECT is((SELECT data_verified_at FROM public.foods WHERE id=-98601),'2026-08-01'::timestamptz,'nutrient verification unchanged');
SELECT throws_ok($$SELECT pg_temp.apply_test(-98602)$$,'CFADQ',NULL,'private target refused');
SELECT throws_ok($$SELECT pg_temp.apply_test(-98601,-98602)$$,'CFADQ',NULL,'foreign source refused');
SELECT throws_ok($$SELECT pg_temp.apply_test(p_hash=>'changed')$$,'CFADQ',NULL,'stale capture hash refused');
SELECT throws_ok($$SELECT pg_temp.apply_test(p_name=>'Other Cat Food')$$,'CFADQ',NULL,'unquoted product name refused');
SELECT throws_ok($$SELECT pg_temp.apply_test(p_statement=>'Example Cat Food meets the AAFCO invented nutritional levels for cats.')$$,'CFADQ',NULL,'invented quote refused');
SELECT ok(NOT has_function_privilege('anon','public.apply_food_adequacy_declaration(bigint,bigint,text,text,text,text)','EXECUTE'),'anon cannot apply');
SELECT ok(NOT has_table_privilege('authenticated','public.food_adequacy_declarations','INSERT'),'authenticated cannot insert');
SELECT ok(NOT has_table_privilege('service_role','public.food_adequacy_declarations','UPDATE'),'service must use broker RPC');
-- Seed private evidence as owner to exercise RLS, independently of the apply guard.
INSERT INTO public.food_adequacy_declarations(food_id,source_id,statement,source_product_name,source_content_hash,captured_at,applied_by_origin)
VALUES(-98602,-98602,'Private Cat Food is formulated to meet AAFCO cat profiles.','Private Cat Food','hash2',now(),'automation');
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::int FROM public.food_adequacy_declarations WHERE food_id IN(-98601,-98602)),1,'anon sees public current evidence only');
RESET ROLE;
UPDATE public.food_sources SET is_current=false WHERE id=-98601;
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.food_adequacy_declarations WHERE food_id IN(-98601,-98602)),0,'retired source is hidden even when evidence remains');
RESET ROLE;
SELECT throws_ok($$SELECT pg_temp.apply_test()$$,'CFADQ',NULL,'retired source refuses reapply');
SELECT is((SELECT published_at FROM public.foods WHERE id=-98601),'2026-08-01'::timestamptz,'publication unchanged');
SELECT * FROM finish();
ROLLBACK;
