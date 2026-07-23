DROP FUNCTION public.replace_current_food_source(
  bigint,
  public.nutrient_source,
  text,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  uuid
);

CREATE FUNCTION public.replace_current_food_source(
  p_food_id bigint,
  p_kind public.nutrient_source,
  p_url text,
  p_capture_method text,
  p_captured_at timestamptz,
  p_content_hash text,
  p_captured_text text,
  p_observed_at timestamptz DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS TABLE(source_id bigint, content_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_hash text;
  v_had_previous boolean;
BEGIN
  IF p_kind NOT IN ('manufacturer', 'kr_label') THEN
    RAISE EXCEPTION 'Source kind % is not supported', p_kind;
  END IF;

  IF p_capture_method NOT IN ('fetch', 'manual') THEN
    RAISE EXCEPTION 'Capture method % is not supported', p_capture_method;
  END IF;

  IF p_url IS NULL
    OR btrim(p_url) = ''
    OR p_captured_at IS NULL
    OR p_content_hash IS NULL
    OR btrim(p_content_hash) = ''
    OR p_captured_text IS NULL
    OR btrim(p_captured_text) = '' THEN
    RAISE EXCEPTION 'Fetched source fields must be complete';
  END IF;

  PERFORM 1
  FROM public.foods
  WHERE id = p_food_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Food % does not exist', p_food_id;
  END IF;

  SELECT content_hash
  INTO v_previous_hash
  FROM public.food_sources
  WHERE food_id = p_food_id
    AND kind = p_kind
    AND fetch_status = 'fetched'
    AND is_current;

  v_had_previous := FOUND;
  content_status := CASE
    WHEN NOT v_had_previous THEN 'initial'
    WHEN v_previous_hash = p_content_hash THEN 'unchanged'
    ELSE 'changed'
  END;

  UPDATE public.food_sources
  SET is_current = false
  WHERE food_id = p_food_id
    AND kind = p_kind
    AND fetch_status = 'fetched'
    AND is_current;

  INSERT INTO public.food_sources (
    food_id,
    kind,
    url,
    capture_method,
    fetch_status,
    failure_code,
    captured_at,
    observed_at,
    content_hash,
    captured_text,
    created_by,
    is_current
  ) VALUES (
    p_food_id,
    p_kind,
    p_url,
    p_capture_method,
    'fetched',
    NULL,
    p_captured_at,
    p_observed_at,
    p_content_hash,
    p_captured_text,
    p_created_by,
    true
  )
  RETURNING id INTO source_id;

  IF p_kind = 'manufacturer' THEN
    UPDATE public.foods
    SET manufacturer_url = p_url
    WHERE id = p_food_id;
  ELSE
    UPDATE public.foods
    SET kr_label_source = p_url
    WHERE id = p_food_id;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_current_food_source(
  bigint,
  public.nutrient_source,
  text,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.replace_current_food_source(
  bigint,
  public.nutrient_source,
  text,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  uuid
) TO service_role;
