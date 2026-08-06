-- 캡처 도중 예외가 나면 DB는 이미 바뀌었는데 원장에는 아무 행도 남지 않았다.
-- 그 사료는 current 출처를 가진 채 skeleton에서 빠져 영구히 재조사 대상이 아니게
-- 되고, 복구 경로로 쓰라고 만든 원장에는 읽을 것이 없다. 실패한 실행도 기록할 수
-- 있도록 terminal status에 'errored'를 추가한다.
ALTER TABLE public.food_research_runs
  DROP CONSTRAINT food_research_runs_status_check;

ALTER TABLE public.food_research_runs
  ADD CONSTRAINT food_research_runs_status_check
  CHECK (
    status IN (
      'applied',
      'rejected',
      'capture_failed',
      'claim_conflict',
      'errored'
    )
  );
