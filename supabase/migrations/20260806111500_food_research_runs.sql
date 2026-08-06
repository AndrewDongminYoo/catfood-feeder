-- 로컬 조사 에이전트 실행 원장.
--
-- 실패한 수집이나 거부된 근거도 제품 데이터다. 다음 실행이 같은 URL을 다시
-- 조사하지 않게 하려면 제안 원문과 서버 판정을 함께 보존해야 한다.
CREATE TABLE public.food_research_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  food_id bigint NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  agent_model text NOT NULL,
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  proposal jsonb NOT NULL,
  captures jsonb NOT NULL,
  evidence_results jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('applied', 'rejected', 'capture_failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX food_research_runs_food_idx
  ON public.food_research_runs (food_id, created_at DESC);

-- 비공개 원장이다. 정책을 하나도 두지 않아 anon/authenticated에는 아무 행도
-- 보이지 않고, service_role만 RLS를 우회해 읽고 쓴다.
ALTER TABLE public.food_research_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.food_research_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.food_research_runs TO service_role;
