-- ============================================================
-- 0003_foods_external_source.sql
-- foods에 외부 출처 식별자 추가 (recalls의 source/external_id 패턴 미러링).
--
-- 목적: 외부 카탈로그(예: Pet Friends 상품 목록)에서 적재한 행을 안정적으로
-- 식별/재적재(upsert)하고, 리서치 에이전트가 특정 행에 성분을 채워 넣을 때
-- 이름 매칭 추측 없이 (source, external_id)로 정확히 타겟팅하기 위함.
--
-- 손으로 추가하는 행은 source/external_id가 NULL이며, Postgres는 NULL을
-- 서로 distinct로 취급하므로 unique 인덱스가 그런 행들을 막지 않는다.
-- ============================================================

alter table foods add column if not exists source text;
alter table foods add column if not exists external_id text;

-- 외부 소스 행의 중복 적재 방지(예: source='pet_friends', external_id=productId)
create unique index if not exists foods_source_external_id_key
  on foods (source, external_id);
