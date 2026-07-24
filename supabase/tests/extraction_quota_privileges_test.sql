BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(10);

CREATE TEMP TABLE extraction_quota_tap_results (
  assertion_number integer PRIMARY KEY,
  tap_line text NOT NULL
) ON COMMIT DROP;
GRANT INSERT ON extraction_quota_tap_results TO anon, authenticated, service_role;

CREATE TEMP TABLE extraction_quota_service_results (
  call_number integer PRIMARY KEY,
  request_count integer NOT NULL
) ON COMMIT DROP;
GRANT INSERT, SELECT ON extraction_quota_service_results TO service_role;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  1 AS assertion_number,
  is(
  (
    SELECT count(*)
    FROM pg_proc AS proc
    CROSS JOIN LATERAL aclexplode(
      coalesce(proc.proacl, acldefault('f', proc.proowner))
    ) AS acl
    WHERE proc.oid = 'public.consume_extract_quota(text,integer,integer)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ),
  0::bigint,
  'PUBLIC has no EXECUTE ACL item for consume_extract_quota'
  ) AS tap_line;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  2 AS assertion_number,
  is(
  has_function_privilege(
    'anon',
    'public.consume_extract_quota(text,integer,integer)',
    'EXECUTE'
  ),
  false,
  'anon cannot execute consume_extract_quota'
  ) AS tap_line;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  3 AS assertion_number,
  is(
  has_function_privilege(
    'authenticated',
    'public.consume_extract_quota(text,integer,integer)',
    'EXECUTE'
  ),
  false,
  'authenticated cannot execute consume_extract_quota'
  ) AS tap_line;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  4 AS assertion_number,
  is(
  has_function_privilege(
    'service_role',
    'public.consume_extract_quota(text,integer,integer)',
    'EXECUTE'
  ),
  true,
  'service_role can execute consume_extract_quota'
  ) AS tap_line;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  5 AS assertion_number,
  is(
  (
    SELECT relation.relrowsecurity
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'extraction_rate_limits'
  ),
  true,
  'extraction_rate_limits has row-level security enabled'
  ) AS tap_line;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  6 AS assertion_number,
  is(
  (
    SELECT count(*)
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'public.extraction_rate_limits'::regclass
  ),
  0::bigint,
  'extraction_rate_limits has no row-level security policies'
  ) AS tap_line;

SET LOCAL ROLE anon;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  7 AS assertion_number,
  throws_ok(
  $$
    SELECT public.consume_extract_quota(
      'pgtap-anon-' || txid_current()::text,
      10,
      60
    )
  $$,
  '42501',
  null,
  'anon RPC calls to consume_extract_quota are rejected'
  ) AS tap_line;

RESET ROLE;
SET LOCAL ROLE authenticated;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  8 AS assertion_number,
  throws_ok(
  $$
    SELECT public.consume_extract_quota(
      'pgtap-authenticated-' || txid_current()::text,
      10,
      60
    )
  $$,
  '42501',
  null,
  'authenticated RPC calls to consume_extract_quota are rejected'
  ) AS tap_line;

RESET ROLE;
SET LOCAL ROLE service_role;

WITH quota_subject AS MATERIALIZED (
  SELECT 'pgtap-service-' || txid_current()::text AS subject
),

first_call AS MATERIALIZED (
  SELECT public.consume_extract_quota(
    quota_subject.subject,
    10,
    60
  ) AS request_count
  FROM quota_subject
),

second_call AS MATERIALIZED (
  SELECT public.consume_extract_quota(
    quota_subject.subject,
    10,
    60
  ) AS request_count
  FROM quota_subject
  CROSS JOIN first_call
  WHERE first_call.request_count IS NOT null
)

INSERT INTO extraction_quota_service_results (call_number, request_count)
SELECT
  1 AS call_number,
  first_call.request_count
FROM first_call

UNION ALL

SELECT
  2 AS call_number,
  second_call.request_count
FROM second_call;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  9 AS assertion_number,
  is(
  (
    SELECT request_count
    FROM extraction_quota_service_results
    WHERE call_number = 1
  ),
  1,
  'service_role can consume the first quota slot'
  ) AS tap_line;

INSERT INTO extraction_quota_tap_results (assertion_number, tap_line)
SELECT
  10 AS assertion_number,
  is(
  (
    SELECT request_count
    FROM extraction_quota_service_results
    WHERE call_number = 2
  ),
  2,
  'service_role can consume the next quota slot for the same subject'
  ) AS tap_line;

RESET ROLE;
SELECT tap_line
FROM (
  SELECT
    assertion_number,
    tap_line
  FROM extraction_quota_tap_results

  UNION ALL

  SELECT
    11 AS assertion_number,
    finish AS tap_line
  FROM finish()
) AS tap_output
ORDER BY assertion_number;
ROLLBACK;
