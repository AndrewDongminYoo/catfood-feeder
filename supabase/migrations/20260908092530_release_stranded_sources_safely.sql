-- 검토한 source ID만 트랜잭션 안에서 다시 판정하고 내린다. foods 행을 먼저 잠가
-- 발행과 evidence apply RPC가 판정과 update 사이에 끼어들지 못하게 한다.
CREATE FUNCTION public.release_stranded_food_sources(p_source_ids bigint [])
RETURNS TABLE(source_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_eligible_count integer;
  v_requested_count integer;
BEGIN
  IF coalesce(cardinality(p_source_ids), 0) = 0
    OR EXISTS (
      SELECT 1
      FROM unnest(p_source_ids) AS requested (id)
      WHERE requested.id IS NULL OR requested.id <= 0
    ) THEN
    RAISE EXCEPTION 'Source IDs must be positive and non-empty'
    USING ERRCODE = 'CFRVW';
  END IF;

  SELECT count(DISTINCT requested.id)
  INTO v_requested_count
  FROM unnest(p_source_ids) AS requested (id);

  IF v_requested_count <> cardinality(p_source_ids) THEN
    RAISE EXCEPTION 'Source IDs must be unique'
    USING ERRCODE = 'CFRVW';
  END IF;

  PERFORM food.id
  FROM public.foods AS food
  WHERE food.id IN (
    SELECT source.food_id
    FROM public.food_sources AS source
    WHERE source.id = ANY (p_source_ids)
  )
  ORDER BY food.id
  FOR UPDATE;

  PERFORM source.id
  FROM public.food_sources AS source
  WHERE source.id = ANY (p_source_ids)
  ORDER BY source.id
  FOR UPDATE;

  SELECT count(*)
  INTO v_eligible_count
  FROM public.food_sources AS source
  JOIN public.foods AS food ON food.id = source.food_id
  WHERE source.id = ANY (p_source_ids)
    AND source.is_current
    AND food.published_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.food_nutrient_evidence AS evidence
      WHERE evidence.source_id = source.id
        AND evidence.is_current
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.food_ingredient_evidence AS evidence
      WHERE evidence.source_id = source.id
        AND evidence.is_current
    );

  IF v_eligible_count <> v_requested_count THEN
    RAISE EXCEPTION 'Reviewed source IDs are no longer stranded'
    USING ERRCODE = 'CFRVW';
  END IF;

  RETURN QUERY
  UPDATE public.food_sources AS source
  SET is_current = false
  WHERE source.id = ANY (p_source_ids)
  RETURNING source.id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_stranded_food_sources(bigint [])
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.release_stranded_food_sources(bigint [])
TO service_role;
