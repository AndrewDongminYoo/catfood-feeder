BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(3);

-- Given: extraction quota mutation is an internal server operation.
-- When: Postgres checks each API role's function privilege.
-- Then: only service_role can execute the quota RPC.
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.consume_extract_quota(text, integer, integer)',
    'EXECUTE'
  ),
  'anon cannot execute extraction quota mutation'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.consume_extract_quota(text, integer, integer)',
    'EXECUTE'
  ),
  'authenticated cannot execute extraction quota mutation'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.consume_extract_quota(text, integer, integer)',
    'EXECUTE'
  ),
  'service role can execute extraction quota mutation'
);

SELECT * FROM finish(TRUE);
ROLLBACK;
