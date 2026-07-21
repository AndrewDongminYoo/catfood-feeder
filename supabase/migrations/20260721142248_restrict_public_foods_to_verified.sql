DROP POLICY IF EXISTS "public read foods" ON public.foods;

CREATE POLICY "public read foods"
  ON public.foods
  FOR SELECT
  TO anon, authenticated
  USING (data_verified_at IS NOT NULL);
