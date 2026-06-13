-- ============================================================
-- 0002_reconcile_remote.sql
-- 원격(런칭 전, 0행) 프로젝트와 커밋된 스키마(0001_init.sql)의 드리프트 정리.
--
-- 원격 DB는 0001_init.sql이 아닌 다른 경로(v0/스캐폴딩 등)로 프로비저닝됨:
--   - 카탈로그 정책이 `anon, authenticated`가 아닌 `public` role로 생성됨
--   - 인덱스 2개(brands_name_manufacturer_normalized_idx, foods_filter_idx) 누락
--   - prices 공개읽기 정책 누락
--   - 외부에서 RLS 자동 활성화 메커니즘(rls_auto_enable + ensure_rls) 설치됨
--
-- 0001은 `supabase migration repair --status applied 0001`로 적용 처리하고,
-- 이 마이그레이션이 나머지 모든 갭을 idempotent하게 닫아 remote == 0001 + 의도된 하드닝이 되게 한다.
-- 컬럼/타입/FK/생성컬럼/트리거/enum은 이미 0001과 일치하므로 건드리지 않는다.
-- ============================================================

-- 1) 0001에 있으나 원격에 누락된 인덱스
create unique index if not exists brands_name_manufacturer_normalized_idx
  on brands (lower(name), coalesce(lower(manufacturer), ''));
create index if not exists foods_filter_idx
  on foods (grain_free, cooking_method, protein_pct);

-- 2) 정책을 0001 정의(`to anon, authenticated`)에 맞춰 재정렬.
--    원격은 `public` role로 생성됨 — 기능상 동등하나 베이스라인을 정직하게 만들기 위해 재생성.
--    prices 정책은 원격에 아예 없었음.
drop policy if exists "public read foods" on foods;
create policy "public read foods" on foods
  for select to anon, authenticated using (true);

drop policy if exists "public read brands" on brands;
create policy "public read brands" on brands
  for select to anon, authenticated using (true);

drop policy if exists "public read recalls" on recalls;
create policy "public read recalls" on recalls
  for select to anon, authenticated using (true);

drop policy if exists "public read prices" on prices;
create policy "public read prices" on prices
  for select to anon, authenticated using (true);

drop policy if exists "owner manages cats" on cats;
create policy "owner manages cats" on cats
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "owner manages logs" on feeding_logs;
create policy "owner manages logs" on feeding_logs
  for all to authenticated
  using (
    exists (
      select 1 from cats
      where cats.id = feeding_logs.cat_id
        and cats.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from cats
      where cats.id = feeding_logs.cat_id
        and cats.owner_id = (select auth.uid())
    )
  );

-- 3) set_updated_at search_path 하드닝 (advisor 0011: mutable search_path).
--    본문은 now()만 호출 — now()는 pg_catalog라 빈 search_path에서도 해석된다.
create or replace function set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 4) 외부 설치된 RLS 자동 활성화 메커니즘을 로컬 스키마에 정본화하고,
--    불필요한 EXECUTE 권한을 회수한다 (advisor 0028/0029).
--    이벤트 트리거는 owner(postgres) 권한으로 동작하므로 권한 회수가 기능에 영향 없음.
create or replace function rls_auto_enable() returns event_trigger
  language plpgsql
  security definer
  set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

revoke execute on function rls_auto_enable() from anon, authenticated, public;

-- 이벤트 트리거는 CREATE EVENT TRIGGER IF NOT EXISTS가 없으므로 존재 확인 후 생성.
-- (원격엔 이미 존재 → no-op; 로컬 db reset / 신규 환경에서만 생성)
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function rls_auto_enable();
  end if;
end
$$;
