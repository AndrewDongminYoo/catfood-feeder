REVOKE EXECUTE ON FUNCTION public.consume_extract_quota(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_extract_quota(text, integer, integer) TO service_role;
