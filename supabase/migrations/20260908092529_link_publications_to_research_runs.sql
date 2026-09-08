-- 한 발행 결정에 기여한 조사 실행을 current evidence의 source_id로 연결한다.
-- 최신 run을 임의로 고르지 않는다. 한 Draft의 값은 여러 실행에서 올 수 있으므로
-- 발행 시점에 실제 current evidence가 참조한 source에 값을 적용한 run을 모두 남긴다.
CREATE TABLE public.food_publication_research_runs (
  food_id bigint NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,
  research_run_id bigint NOT NULL REFERENCES public.food_research_runs(id) ON DELETE CASCADE,
  published_at timestamptz NOT NULL,
  PRIMARY KEY (food_id, research_run_id)
);

CREATE INDEX food_publication_research_runs_run_idx
  ON public.food_publication_research_runs (research_run_id);

ALTER TABLE public.food_publication_research_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.food_publication_research_runs
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.food_publication_research_runs TO service_role;

-- trigger와 기존 행 backfill이 같은 선별 규칙을 사용한다. run이 source를 단순히
-- 캡처한 것만으로는 부족하고, 그 source URL의 근거 결과가 applied여야 한다.
CREATE FUNCTION public.food_publication_research_run_ids(p_food_id bigint)
RETURNS TABLE(research_run_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT run.id
  FROM public.food_research_runs AS run
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(run.captures) = 'array' THEN run.captures
      ELSE '[]'::jsonb
    END
  ) AS captured (value)
  WHERE run.food_id = p_food_id
    AND run.status = 'applied'
    AND captured.value ->> 'sourceId' ~ '^[0-9]+$'
    AND jsonb_typeof(captured.value -> 'url') = 'string'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(run.evidence_results) = 'array' THEN run.evidence_results
          WHEN jsonb_typeof(run.evidence_results -> 'outcomes') = 'array'
            THEN run.evidence_results -> 'outcomes'
          ELSE '[]'::jsonb
        END
      ) AS outcome (value)
      WHERE outcome.value ->> 'status' = 'applied'
        AND outcome.value ->> 'sourceUrl' = captured.value ->> 'url'
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.food_nutrient_evidence AS evidence
        WHERE evidence.food_id = p_food_id
          AND evidence.source_id = (captured.value ->> 'sourceId')::bigint
          AND evidence.is_current
      )
      OR EXISTS (
        SELECT 1
        FROM public.food_ingredient_evidence AS evidence
        WHERE evidence.food_id = p_food_id
          AND evidence.source_id = (captured.value ->> 'sourceId')::bigint
          AND evidence.is_current
      )
    );
$$;

REVOKE ALL ON FUNCTION public.food_publication_research_run_ids(bigint)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.link_food_publication_research_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.published_at IS NULL AND NEW.published_at IS NOT NULL THEN
    INSERT INTO public.food_publication_research_runs (
      food_id,
      research_run_id,
      published_at
    )
    SELECT NEW.id, linked.research_run_id, NEW.published_at
    FROM public.food_publication_research_run_ids(NEW.id) AS linked
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.link_food_publication_research_runs()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER foods_link_publication_research_runs
AFTER UPDATE OF published_at ON public.foods
FOR EACH ROW
EXECUTE FUNCTION public.link_food_publication_research_runs();

-- 기존 발행 행도 같은 증거 연결 규칙으로 채운다.
INSERT INTO public.food_publication_research_runs (
  food_id,
  research_run_id,
  published_at
)
SELECT food.id, linked.research_run_id, food.published_at
FROM public.foods AS food
CROSS JOIN LATERAL public.food_publication_research_run_ids(food.id) AS linked
WHERE food.published_at IS NOT NULL
ON CONFLICT DO NOTHING;
