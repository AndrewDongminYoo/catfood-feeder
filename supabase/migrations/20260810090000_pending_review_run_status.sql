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

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'food_research_runs_status_check'
      AND pg_get_constraintdef(oid) LIKE '%pending_review%'
  ) THEN
    RAISE EXCEPTION 'pending_review 가 제약에 없다';
  END IF;
END $verify$;

COMMIT;
