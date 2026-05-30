-- ============================================================
-- 수입 건사료 큐레이션 서비스 — 스키마 (확정본)
-- Postgres / Supabase
-- 도메인 규칙은 BLUEPRINT.md "핵심 도메인 규칙" 참조
-- ============================================================

-- 출처 enum: 성분 수치가 어디서 왔는지 (실측과 추정을 절대 섞지 않기 위함)
create type nutrient_source as enum ('manufacturer', 'kr_label', 'estimated', 'derived');

-- 제조법: 회분 추정(익스트루전 9.0%) 허용 여부 판단에 사용
create type cooking_method as enum ('extrusion', 'baked', 'freeze_dried', 'dried');

-- ─── 브랜드 / 제조사 / 수입사 ───────────────────────────────
-- 수입사는 변경이 잦아 nullable. 제조사+브랜드가 식별의 축.
create table brands (
  id            bigint generated always as identity primary key,
  name          text not null,                 -- 브랜드명 (예: ACANA)
  manufacturer  text,                           -- 제조사 (예: Champion Petfoods)
  importer      text,                           -- 국내 수입사 (예: 두원실업) — 변경 잦음
  country       text,                           -- 원산지
  homepage_url  text,
  created_at    timestamptz not null default now(),
  unique (name, manufacturer)
);

-- ─── 사료 제품 ──────────────────────────────────────────────
create table foods (
  id              bigint generated always as identity primary key,
  brand_id        bigint not null references brands(id) on delete restrict,
  product_name    text not null,
  weight_kg       numeric(6,2),
  cooking_method  cooking_method,

  -- 보장성분 (라벨 보증치 기반, 단위 %). 필터·정렬 대상이라 평탄 numeric 유지.
  protein_pct     numeric(5,2),
  fat_pct         numeric(5,2),
  fiber_pct       numeric(5,2),
  ash_pct         numeric(5,2),      -- 제조사 미표기 잦음 → kr_label/estimated로 보충
  moisture_pct    numeric(5,2),
  calcium_pct     numeric(5,2),
  phosphorus_pct  numeric(5,2),
  kcal_per_kg     numeric(7,2),      -- 제조사 미표기 잦음

  -- 탄수화물(NFE): 회분 유무로 계산 가능 여부가 갈리므로 generated 아님(일반 컬럼).
  -- 입력 도구가 계산 가능할 때만 채우고, 추정 회분 기반이면 carb_is_estimated=true.
  carb_pct          numeric(5,2),
  carb_is_estimated boolean not null default false,

  -- P/F/C 열량비: 제조사 직접 명시(manufacturer) 또는 NFE 역산(derived). 출처는 nutrient_sources에.
  energy_p_pct    numeric(5,2),
  energy_f_pct    numeric(5,2),
  energy_c_pct    numeric(5,2),

  -- Ca:P (= P/Ca). 두 값 모두 있고 calcium>0일 때만. 이건 안전하게 generated stored 유지.
  ca_p_ratio      numeric(5,3) generated always as (
                    case when calcium_pct is not null and calcium_pct > 0
                         and phosphorus_pct is not null
                    then round(phosphorus_pct / calcium_pct, 3) end
                  ) stored,

  -- 항목별 출처 메타: {"protein_pct":"manufacturer","ash_pct":"kr_label","energy_p_pct":"manufacturer",...}
  nutrient_sources jsonb not null default '{}',

  -- 원료: [{"name":"Duck","pct":null,"type":"meat"}, ...]
  ingredients     jsonb not null default '[]',

  -- 기능성 플래그
  grain_free      boolean not null default false,
  meal_free       boolean not null default false,
  has_probiotics  boolean not null default false,
  has_cranberry   boolean not null default false,
  has_yucca       boolean not null default false,

  -- 위험성분: 라벨 미표기·사후검출이라 필터 가치 낮음 → 부가정보로만 강등 보관
  caution_ingredients text[] not null default '{}',

  -- 출처 추적
  manufacturer_url  text,            -- 제조사 성분표 출처
  kr_label_source   text,            -- 국내 라벨 출처(수입사명/이미지 등)
  data_verified_at  timestamptz,     -- 사람이 마지막으로 검증한 시점 (갱신 우선순위 쿼리용)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index foods_brand_idx        on foods (brand_id);
create index foods_protein_idx      on foods (protein_pct);
create index foods_carb_idx         on foods (carb_pct);
create index foods_verified_idx     on foods (data_verified_at);
create index foods_caution_gin      on foods using gin (caution_ingredients);
create index foods_ingredients_gin  on foods using gin (ingredients);

-- updated_at 자동 갱신
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
create trigger foods_updated_at before update on foods
  for each row execute function set_updated_at();

-- ─── 리콜 (openFDA 등 외부 소스 동기화) ─────────────────────
-- 리콜은 제품행이 아니라 브랜드/로트 단위. food_id는 특정될 때만 연결.
create table recalls (
  id            bigint generated always as identity primary key,
  brand_id      bigint references brands(id) on delete set null,
  food_id       bigint references foods(id) on delete set null,
  source        text not null,                 -- 'openFDA' | '검역본부' 등
  source_url    text not null,
  external_id   text,                           -- openFDA event_id 등 (중복 동기화 방지)
  recalling_firm text,
  reason        text,
  classification text,                          -- Class I/II/III
  affected_lots text,
  recall_date   date,
  region        text,                           -- 'US' | 'KR'
  created_at    timestamptz not null default now(),
  unique (source, external_id)
);
create index recalls_brand_idx on recalls (brand_id, recall_date desc);

-- ─── 가격 (Phase 5 보류 — 스키마만 미리 정의) ───────────────
create table prices (
  id             bigint generated always as identity primary key,
  food_id        bigint not null references foods(id) on delete cascade,
  retailer       text not null,
  price          numeric(10,2) not null,
  price_per_100g numeric(10,2),
  url            text,
  captured_at    timestamptz not null default now()
);
create index prices_food_idx on prices (food_id, captured_at desc);

-- ─── 급여 기록 (Phase 4) ────────────────────────────────────
create table cats (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  birth_date  date,
  created_at  timestamptz not null default now()
);
create index cats_owner_idx on cats (owner_id);

create table feeding_logs (
  id          bigint generated always as identity primary key,
  cat_id      bigint not null references cats(id) on delete cascade,
  food_id     bigint not null references foods(id) on delete restrict,
  started_on  date not null,
  ended_on    date,                              -- null = 현재 급여 중
  note        text,
  created_at  timestamptz not null default now()
);
create index feeding_logs_cat_idx on feeding_logs (cat_id, started_on desc);

-- ============================================================
-- RLS (Supabase): 카탈로그/리콜은 공개 읽기, 급여기록은 소유자만
-- ============================================================
alter table foods    enable row level security;
alter table brands   enable row level security;
alter table recalls  enable row level security;
alter table cats         enable row level security;
alter table feeding_logs enable row level security;

create policy "public read foods"   on foods   for select using (true);
create policy "public read brands"  on brands  for select using (true);
create policy "public read recalls" on recalls for select using (true);

-- 쓰기는 service_role(서버 라우트)만 — 입력 도구는 서버에서 service key로 insert
-- (anon 키로는 insert 불가. 별도 admin 정책은 운영 단계에서 추가.)

create policy "owner manages cats" on cats
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "owner manages logs" on feeding_logs
  for all using (exists (select 1 from cats where cats.id = feeding_logs.cat_id and cats.owner_id = auth.uid()))
  with check (exists (select 1 from cats where cats.id = feeding_logs.cat_id and cats.owner_id = auth.uid()));
