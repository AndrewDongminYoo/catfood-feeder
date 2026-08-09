-- 전사 제안은 사람의 확인을 기다린다. 기존 상태값은 전부 종료 상태라 그 대기를
-- 표현할 수 없었다. 이미지 라벨 경로에서는 기계 출력이 곧바로 값이 되지 않고
-- pending_review 로 쌓였다가 운영자가 승인할 때 applied 로, 건너뛰면 rejected 로 간다.

BEGIN;

ALTER TABLE public.food_research_runs
  DROP CONSTRAINT food_research_runs_status_check;

ALTER TABLE public.food_research_runs
  ADD CONSTRAINT food_research_runs_status_check
  CHECK (status = ANY(ARRAY[
    'applied',
    'rejected',
    'capture_failed',
    'claim_conflict',
    'errored',
    'invalid',
    'pending_review'
  ]::text[]));

-- LIKE '%pending_review%' 는 부분 문자열 검사라 기존 6개 상태가 실수로 함께
-- 빠져도 못 잡고, 'pending_reviews' 같은 오타도 통과시킨다. 정확히 이 7개와
-- 그 외에는 아무것도 없는지를 등호로 비교한다.
DO $verify$
DECLARE
  v_def text;
  v_expected text := 'CHECK ((status = ANY (ARRAY[''applied''::text, ''rejected''::text, ''capture_failed''::text, ''claim_conflict''::text, ''errored''::text, ''invalid''::text, ''pending_review''::text])))';
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conname = 'food_research_runs_status_check';

  IF v_def IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION '상태 제약이 기대한 7개 값과 정확히 일치하지 않는다: %', v_def;
  END IF;
END $verify$;

COMMIT;
