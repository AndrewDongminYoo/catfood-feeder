CREATE TABLE extraction_rate_limits (
  subject text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  PRIMARY KEY (subject, window_started_at)
);

ALTER TABLE extraction_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION consume_extract_quota(
  p_subject text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_started_at timestamptz;
  v_request_count integer;
BEGIN
  IF p_subject = '' OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid extraction quota arguments';
  END IF;

  v_window_started_at := to_timestamp(
    floor(extract(epoch FROM statement_timestamp()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO extraction_rate_limits (subject, window_started_at)
  VALUES (p_subject, v_window_started_at)
  ON CONFLICT (subject, window_started_at)
  DO UPDATE SET request_count = extraction_rate_limits.request_count + 1
  RETURNING request_count INTO v_request_count;

  RETURN v_request_count;
END;
$$;

REVOKE ALL ON TABLE extraction_rate_limits FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_extract_quota(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_extract_quota(text, integer, integer) TO service_role;
