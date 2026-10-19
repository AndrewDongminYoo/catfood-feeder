-- Manufacturer claims are independent evidence, never a nutrient verification stamp.
CREATE TABLE public.food_adequacy_declarations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  food_id bigint NOT NULL REFERENCES public.foods (id) ON DELETE CASCADE,
  source_id bigint NOT NULL REFERENCES public.food_sources (id) ON DELETE RESTRICT,
  -- Literal manufacturer statement; valid PostgreSQL column name.
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 20 AND 1200), -- noqa: RF04
  source_product_name text NOT NULL CHECK (length(btrim(source_product_name)) BETWEEN 3 AND 350),
  source_content_hash text NOT NULL,
  captured_at timestamptz NOT NULL,
  applied_by_origin text NOT NULL CHECK (applied_by_origin IN ('human', 'automation')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX food_adequacy_source_idx ON public.food_adequacy_declarations (food_id, source_id);
CREATE INDEX food_adequacy_source_fk_idx ON public.food_adequacy_declarations (source_id);
ALTER TABLE public.food_adequacy_declarations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_adequacy_declarations FROM public, anon, authenticated, service_role;
GRANT SELECT ON public.food_adequacy_declarations TO anon, authenticated, service_role;
CREATE POLICY published_current_manufacturer_declarations ON public.food_adequacy_declarations
FOR SELECT TO anon, authenticated
USING (
  EXISTS (SELECT 1 FROM public.foods f WHERE f.id = food_adequacy_declarations.food_id AND f.published_at IS NOT NULL)
  -- food_sources RLS supplies current/fetched/public filtering; those columns are private.
  AND EXISTS (SELECT 1 FROM public.food_sources s WHERE s.id = food_adequacy_declarations.source_id AND s.food_id = food_adequacy_declarations.food_id AND s.kind = 'manufacturer')
);

CREATE FUNCTION public.apply_food_adequacy_declaration(
  p_food_id bigint, p_source_id bigint, p_statement text,
  p_source_product_name text, p_expected_content_hash text, p_applied_by_origin text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_source public.food_sources%ROWTYPE;
  v_existing public.food_adequacy_declarations%ROWTYPE;
  v_statement text := regexp_replace(normalize(btrim(p_statement), NFKC), '\s+', ' ', 'g');
  v_name text := regexp_replace(normalize(btrim(p_source_product_name), NFKC), '\s+', ' ', 'g');
  v_capture text;
  v_id bigint;
BEGIN
  IF p_applied_by_origin IS NULL OR p_applied_by_origin NOT IN ('human', 'automation')
    OR v_statement IS NULL OR length(v_statement) NOT BETWEEN 20 AND 1200
    OR v_name IS NULL OR length(v_name) NOT BETWEEN 3 AND 350
    OR position(v_name IN v_statement) = 0
    OR p_expected_content_hash IS NULL OR p_expected_content_hash = '' THEN
    RAISE EXCEPTION 'Invalid declaration input' USING ERRCODE = 'CFADQ';
  END IF;
  -- Match the existing source replacement lock order: food, then source.
  PERFORM 1 FROM public.foods WHERE id = p_food_id AND published_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A published food is required' USING ERRCODE = 'CFADQ';
  END IF;
  SELECT * INTO v_source FROM public.food_sources WHERE id = p_source_id FOR SHARE;
  IF NOT FOUND OR v_source.food_id <> p_food_id OR NOT v_source.is_current
    OR v_source.kind <> 'manufacturer' OR v_source.fetch_status <> 'fetched'
    OR v_source.captured_at IS NULL OR v_source.captured_text IS NULL
    OR v_source.content_hash IS DISTINCT FROM p_expected_content_hash
    OR v_source.url NOT LIKE 'https://%' THEN
    RAISE EXCEPTION 'Current matching manufacturer capture required' USING ERRCODE = 'CFADQ';
  END IF;
  v_capture := regexp_replace(normalize(v_source.captured_text, NFKC), '\s+', ' ', 'g');
  IF position(v_statement IN v_capture) = 0
    OR v_statement !~* '(AAFCO|FEDIAF)'
    OR v_statement ~* '\m(dog|puppy|puppies|not|no|never|cannot|unable|fails?|failed|without)\M'
    OR v_statement ~* '(충족하지|충족.*못|완전.*아닙)'
    OR v_statement !~* '(formulated to meet|animal feeding tests?|comparable in nutritional adequacy|meets? the (AAFCO|FEDIAF)|충족.*제조)' THEN
    RAISE EXCEPTION 'Literal positive manufacturer declaration required' USING ERRCODE = 'CFADQ';
  END IF;
  SELECT * INTO v_existing FROM public.food_adequacy_declarations
  WHERE food_id = p_food_id AND source_id = p_source_id;
  IF FOUND THEN
    IF v_existing.statement = btrim(p_statement) AND v_existing.source_product_name = btrim(p_source_product_name)
      AND v_existing.source_content_hash = p_expected_content_hash THEN
      RETURN jsonb_build_object('status', 'skipped', 'id', v_existing.id);
    END IF;
    RETURN jsonb_build_object('status', 'conflict', 'id', v_existing.id);
  END IF;
  INSERT INTO public.food_adequacy_declarations (food_id, source_id, statement, source_product_name,
    source_content_hash, captured_at, applied_by_origin)
  VALUES (p_food_id, p_source_id, btrim(p_statement), btrim(p_source_product_name), p_expected_content_hash,
    v_source.captured_at, p_applied_by_origin) RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'applied', 'id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_food_adequacy_declaration(bigint, bigint, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_food_adequacy_declaration(bigint, bigint, text, text, text, text) TO service_role;
