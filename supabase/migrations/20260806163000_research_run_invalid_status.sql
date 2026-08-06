-- 스키마 검증에서 거절된 제안도 원장에 남긴다.
--
-- 지금은 zod 게이트가 원장 기록보다 앞에 있어서, 거절된 제안은 아무 흔적도 남기지
-- 않는다. 그러면 그 URL이 attemptedUrls에 오르지 않아 다음 실행이 같은 URL을 다시
-- 제안하고, 유료 조사 실행이 무한히 반복된다. http:// 뿐 아니라 kind 중복,
-- nutrient key 중복, 출처와 연결되지 않은 근거 등 모든 거절 사유가 같은 모양이다.
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
      'errored',
      'invalid'
    )
  );
