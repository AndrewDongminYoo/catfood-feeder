BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(13);

INSERT INTO public.brands (id, name, ko_name, manufacturer)
OVERRIDING SYSTEM VALUE
VALUES (-93001, 'pgTAP source replacement brand', 'pgTAP source replacement brand', 'pgTAP manufacturer');

INSERT INTO public.foods (
  id,
  brand_id,
  product_name
)
OVERRIDING SYSTEM VALUE
VALUES
  (-93001, -93001, 'changed replacement'),
  (-93002, -93001, 'failed replacement'),
  (
    -93003,
    -93001,
    'unchanged replacement'
  ),
  (-93004, -93001, 'initial replacement');

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
  (
    -93001,
    -93001,
    'manufacturer',
    'https://example.test/success-old',
    'fetch',
    'fetched',
    now() - interval '1 day',
    'success-old',
    'Protein 30%'
  ),
  (
    -93002,
    -93002,
    'manufacturer',
    'https://example.test/failure-old',
    'fetch',
    'fetched',
    now() - interval '1 day',
    'failure-old',
    'Protein 31%'
  ),
  (
    -93003,
    -93003,
    'manufacturer',
    'https://example.test/unchanged-old',
    'fetch',
    'fetched',
    now() - interval '1 day',
    'unchanged-hash',
    'Protein 35%'
  );

-- Supabase Cloud grants service_role SELECT on public tables via schema default
-- privileges; a local `supabase start` does not, so the direct food_sources
-- reads below would hit "permission denied" under SET ROLE service_role. Grant
-- what the role reads directly (the RPC is SECURITY DEFINER and runs as its
-- owner, so it needs no grant here). Transactional, undone by the ROLLBACK.
GRANT SELECT ON public.food_sources TO service_role;

-- Given: untrusted API roles can discover the public RPC name.
-- When: they attempt to execute the source replacement RPC.
-- Then: Postgres denies execution before revealing food state.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$
    SELECT public.replace_current_food_source(
      -93999,
      'manufacturer',
      'https://example.test/denied',
      'fetch',
      now(),
      'denied',
      'Protein 99%',
      NULL,
      NULL
    )
  $$,
  '42501',
  NULL,
  'anon cannot execute source replacement'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$
    SELECT public.replace_current_food_source(
      -93999,
      'manufacturer',
      'https://example.test/denied',
      'fetch',
      now(),
      'denied',
      'Protein 99%',
      NULL,
      NULL
    )
  $$,
  '42501',
  NULL,
  'authenticated cannot execute source replacement'
);
RESET ROLE;

-- Given: service_role supplies a source kind outside the ledger CHECK contract.
-- When: the RPC validates the request before changing current-source state.
-- Then: the call fails and leaves the existing source untouched.
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.replace_current_food_source(
      -93001,
      'estimated',
      'https://example.test/invalid-kind',
      'fetch',
      now(),
      'invalid-kind',
      'Protein 32%',
      NULL,
      NULL
    )
  $$,
  'P0001',
  'Source kind estimated is not supported',
  'source replacement rejects unsupported source kinds'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.food_sources
    WHERE food_id = -93001
      AND is_current
  ),
  1::bigint,
  'invalid source replacement preserves the current source'
);

-- Given: a current fetched manufacturer source has a different content hash.
-- When: service_role replaces it with a new successful capture.
-- Then: the RPC reports changed and returns the inserted source ID.
SELECT ok(
  (
    SELECT
      to_jsonb(result) ->> 'content_status' = 'changed'
      AND (to_jsonb(result) ->> 'source_id')::bigint > 0
    FROM public.replace_current_food_source(
      -93001,
      'manufacturer',
      'https://example.test/success-old',
      'fetch',
      '2026-07-22 12:00:00+00'::timestamptz,
      'success-new',
      'Protein 33%',
      '2026-07-22 11:00:00+00'::timestamptz,
      NULL
    ) AS result
  ),
  'changed content returns changed with the inserted source ID'
);
RESET ROLE;

SELECT is(
  (
    SELECT is_current
    FROM public.food_sources
    WHERE id = -93001
  ),
  FALSE,
  'successful replacement retires the previous source'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.food_sources
    WHERE food_id = -93001
      AND kind = 'manufacturer'
      AND url = 'https://example.test/success-old'
      AND capture_method = 'fetch'
      AND fetch_status = 'fetched'
      AND captured_at = '2026-07-22 12:00:00+00'::timestamptz
      AND observed_at = '2026-07-22 11:00:00+00'::timestamptz
      AND content_hash = 'success-new'
      AND captured_text = 'Protein 33%'
      AND is_current
  ),
  1::bigint,
  'successful replacement inserts the complete current capture'
);

-- Given: a current fetched manufacturer source has the same content hash.
-- When: service_role replaces it with a repeated successful capture.
-- Then: the RPC reports unchanged and returns the new source ID.
SET LOCAL ROLE service_role;
SELECT ok(
  (
    SELECT
      to_jsonb(result) ->> 'content_status' = 'unchanged'
      AND (to_jsonb(result) ->> 'source_id')::bigint > 0
    FROM public.replace_current_food_source(
      -93003,
      'manufacturer',
      'https://example.test/unchanged-old',
      'manual',
      '2026-07-23 12:00:00+00'::timestamptz,
      'unchanged-hash',
      'Protein 35%',
      NULL,
      NULL
    ) AS result
  ),
  'equal content returns unchanged with the inserted source ID'
);
RESET ROLE;

-- Given: no current fetched source exists for the food and kind.
-- When: service_role stores its first successful capture.
-- Then: the RPC reports initial and returns the inserted source ID.
SET LOCAL ROLE service_role;
SELECT ok(
  (
    SELECT
      to_jsonb(result) ->> 'content_status' = 'initial'
      AND (to_jsonb(result) ->> 'source_id')::bigint > 0
    FROM public.replace_current_food_source(
      -93004,
      'manufacturer',
      'https://example.test/initial',
      'fetch',
      '2026-07-23 13:00:00+00'::timestamptz,
      'initial-hash',
      'Protein 36%',
      NULL,
      NULL
    ) AS result
  ),
  'first content returns initial with the inserted source ID'
);
RESET ROLE;

-- 실패를 어디에 주입하는가: 예전에는 RPC 의 마지막 문장이 foods 의 호환용 URL
-- 컬럼을 갱신하는 것이어서 거기에 트리거를 걸었다. 그 컬럼이 사라진 뒤로 마지막
-- 문장은 새 출처의 INSERT 다. 증명하려는 성질은 그대로다 — 강등이 먼저 일어난 뒤
-- 뒤의 문장이 실패하면 강등까지 함께 되돌아가는가.
CREATE FUNCTION pg_temp.reject_source_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.url = 'https://example.test/failure-new' THEN
    RAISE EXCEPTION 'forced source insert failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reject_source_insert
BEFORE INSERT ON public.food_sources
FOR EACH ROW
EXECUTE FUNCTION pg_temp.reject_source_insert();

-- Given: the insert of the replacement source is forced to fail.
-- When: service_role attempts to replace the current source.
-- Then: Postgres rolls back the demotion that the same RPC statement had done.
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.replace_current_food_source(
      -93002,
      'manufacturer',
      'https://example.test/failure-new',
      'manual',
      '2026-07-22 13:00:00+00'::timestamptz,
      'failure-new',
      'Protein 34%',
      NULL,
      NULL
    )
  $$,
  'P0001',
  'forced source insert failure',
  'a failed source insert aborts the whole replacement'
);
RESET ROLE;

SELECT is(
  (
    SELECT is_current
    FROM public.food_sources
    WHERE id = -93002
  ),
  TRUE,
  'failed replacement restores the previous current source'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.food_sources
    WHERE food_id = -93002
      AND url = 'https://example.test/failure-new'
  ),
  0::bigint,
  'failed replacement removes the attempted new source'
);

SELECT is(
  (
    SELECT count(*)
    FROM public.food_sources
    WHERE food_id = -93002
      AND kind = 'manufacturer'
      AND fetch_status = 'fetched'
      AND is_current
  ),
  1::bigint,
  'failed replacement preserves exactly one current fetched source'
);

SELECT * FROM finish(TRUE);
ROLLBACK;
