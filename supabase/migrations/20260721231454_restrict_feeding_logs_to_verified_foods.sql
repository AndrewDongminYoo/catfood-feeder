DROP POLICY IF EXISTS "owner manages logs" ON public.feeding_logs;

CREATE POLICY "owner manages logs"
  ON public.feeding_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cats AS c
      WHERE c.id = feeding_logs.cat_id
        AND c.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cats AS c
      WHERE c.id = feeding_logs.cat_id
        AND c.owner_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM public.foods AS f
      WHERE f.id = feeding_logs.food_id
        AND f.data_verified_at IS NOT NULL
    )
  );
