-- Data API roles do not inherit a reliable table or sequence privilege baseline.
-- Reset the current application surface, then grant only the operations exercised
-- by public catalog reads, owner-scoped feeding data, and service-role curation.

REVOKE ALL ON TABLE
  public.brands,
  public.foods,
  public.recalls,
  public.prices,
  public.cats,
  public.feeding_logs,
  public.food_sources,
  public.food_nutrient_evidence,
  public.food_research_runs,
  public.extraction_rate_limits
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON SEQUENCE
  public.brands_id_seq,
  public.foods_id_seq,
  public.recalls_id_seq,
  public.prices_id_seq,
  public.cats_id_seq,
  public.feeding_logs_id_seq,
  public.food_sources_id_seq,
  public.food_nutrient_evidence_id_seq,
  public.food_research_runs_id_seq
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
  public.brands,
  public.foods,
  public.recalls,
  public.prices
TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.cats,
  public.feeding_logs
TO authenticated;

GRANT USAGE ON SEQUENCE
  public.cats_id_seq,
  public.feeding_logs_id_seq
TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.brands,
  public.foods,
  public.recalls,
  public.food_sources
TO service_role;

GRANT SELECT ON TABLE public.food_nutrient_evidence TO service_role;
GRANT SELECT, INSERT ON TABLE public.food_research_runs TO service_role;
GRANT UPDATE (status) ON TABLE public.food_research_runs TO service_role;

GRANT USAGE ON SEQUENCE
  public.brands_id_seq,
  public.foods_id_seq,
  public.recalls_id_seq,
  public.food_sources_id_seq,
  public.food_research_runs_id_seq
TO service_role;
