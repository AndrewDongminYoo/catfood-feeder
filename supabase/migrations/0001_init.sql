-- ============================================================
-- 수입 건사료 큐레이션 서비스 — 스키마 (확정본)
-- Supabase / Postgres
--
-- 핵심 아이디어:
-- 1) 성분 수치의 "출처(source)"를 분리해서 데이터 품질을 관리한다.
-- 2) 추정/실측/역산을 섞지 않기 위해 nutrient_sources를 JSONB로 추적한다.
-- 3) 공개 데이터(카탈로그/리콜)는 누구나 읽되(select),
--    개인 데이터(고양이/급여기록)는 소유자만 접근하도록 RLS를 건다.
--
-- 도메인 규칙은 BLUEPRINT.md "핵심 도메인 규칙" 참조
-- ============================================================

-- ============================================================
-- Enum: 성분 수치의 출처를 고정된 값으로 관리 (mix 방지)
-- ============================================================
-- nutrient_source: 성분 수치가 "어디서 왔는지"
-- - manufacturer: 제조사 라벨/문서 기반(직접)
-- - kr_label: 국내 라벨 기반
-- - estimated: 규칙/모델로 추정한 값(추정)
-- - derived: 다른 성분을 기반으로 역산한 값(derived)
create type nutrient_source as enum ('manufacturer', 'kr_label', 'estimated', 'derived');

-- ============================================================
-- Enum: 제조/가공 방식도 고정 선택지로 관리
-- ============================================================
-- cooking_method: 제조법(열/가공 공정)
create type cooking_method as enum ('extrusion', 'baked', 'freeze_dried', 'dried');

-- ─────────────────────────────────────────────────────────────
-- 브랜드 / 제조사 / 수입사
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - importer(수입사)는 변경이 잦을 수 있으므로 nullable.
-- - 식별의 축은 (name + manufacturer)로 잡음.
create table brands (
  id            bigint generated always as identity primary key,

  -- 브랜드명 (e.g. ACANA)
  name          text not null,

  -- 제조사 (e.g. Champion Petfoods) — 식별에 중요
  manufacturer  text,

  -- 국내 수입사 (변경 잦음) — 식별 축이 아님
  importer      text,

  -- 원산지
  country       text,

  -- 제조/브랜드 홈 URL (선택)
  homepage_url  text,

  created_at    timestamptz not null default now(),

  -- 같은 이름이라도 manufacturer가 다르면 다른 레코드로 취급
  unique (name, manufacturer)
);

-- ─────────────────────────────────────────────────────────────
-- 사료 제품: foods
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - label/문서에서 들어오는 "보장성분"을 numeric으로 평탄하게 저장
--   -> 필터/정렬/범위쿼리에 유리
-- - carb_pct, energy ratios 등은 추정/역산 여부를 함께 관리
-- - ca_p_ratio 같은 반복 계산은 generated stored로 DB가 관리
create table foods (
  id              bigint generated always as identity primary key,

  -- foods는 brands에 종속(브랜드 삭제는 막음)
  brand_id        bigint not null references brands(id) on delete restrict,

  -- 제품명 (예: Duck & Potato)
  product_name    text not null,

  -- 제품 무게(kg) (선택)
  weight_kg       numeric(6,2),

  -- 제조법(선택) — 고정 enum
  cooking_method  cooking_method,

  -- ==========================================================
  -- 보장성분(단위 %)
  -- ==========================================================
  -- 필터/정렬 대상이므로 numeric(소수 2자리)로 "평탄" 유지
  protein_pct     numeric(5,2),
  fat_pct         numeric(5,2),
  fiber_pct       numeric(5,2),

  -- ash_pct(회분)은 제조사 미표기 상황이 있어 보충될 수 있음
  ash_pct         numeric(5,2),

  moisture_pct    numeric(5,2),
  calcium_pct     numeric(5,2),
  phosphorus_pct  numeric(5,2),

  -- kcal/kg
  kcal_per_kg     numeric(7,2),

  -- ==========================================================
  -- 탄수화물(NFE): 값 자체 + 추정 여부를 분리
  -- ==========================================================
  -- NFE(carbs)는 계산 가능/불가능 상태가 데이터마다 갈릴 수 있음
  -- 따라서:
  -- - carb_pct: numeric value
  -- - carb_is_estimated: 이 값이 추정인지 여부
  carb_pct            numeric(5,2),
  carb_is_estimated  boolean not null default false,

  -- ==========================================================
  -- P/F/C 열량비(에너지 비율)
  -- ==========================================================
  -- energy_p_pct / energy_f_pct / energy_c_pct
  -- - source는 nutrient_sources JSONB로 추적
  energy_p_pct    numeric(5,2),
  energy_f_pct    numeric(5,2),
  energy_c_pct    numeric(5,2),

  -- ==========================================================
  -- Ca:P 비율
  -- ==========================================================
  -- generated always:
  -- - calcium_pct, phosphorus_pct가 있을 때만 계산
  -- - stored:
  --   * 쿼리 시 실시간 계산 대신 DB에 저장되어 성능/일관성이 좋아짐
  -- 주의:
  -- - 조건이 맞지 않으면 NULL 반환 (calcium=0 등)
  ca_p_ratio      numeric(5,3) generated always as (
                    case when calcium_pct is not null and calcium_pct > 0
                         and phosphorus_pct is not null
                    then round(phosphorus_pct / calcium_pct, 3)
                    end
                  ) stored,

  -- ==========================================================
  -- 각 성분 값의 출처 메타데이터
  -- ==========================================================
  -- {"protein_pct":"manufacturer","ash_pct":"kr_label","energy_p_pct":"manufacturer", ...}
  -- 이 JSON을 통해 "추정/실측/역산"을 섞지 않도록 관리
  nutrient_sources jsonb not null default '{}',

  -- 원료 목록 (구조가 유동적일 수 있어 JSONB 선택)
  -- 예: [{"name":"Duck","pct":null,"type":"meat"}, ...]
  ingredients     jsonb not null default '[]',

  -- 기능성 플래그 (빠른 필터링)
  grain_free      boolean not null default false,
  meal_free       boolean not null default false,
  has_probiotics  boolean not null default false,
  has_cranberry   boolean not null default false,
  has_yucca       boolean not null default false,

  -- 위험성분(라벨 미표기/사후 검출 등): 검색 가치 낮음 -> 부가정보로만 저장
  caution_ingredients text[] not null default '{}',

  -- ==========================================================
  -- 출처/검증 관련 링크/시간
  -- ==========================================================
  manufacturer_url  text,            -- 제조사 성분표/문서 URL
  kr_label_source   text,           -- 국내 라벨 출처(수입사명/이미지 등)

  -- 사람이 마지막으로 검증한 시점 (갱신 우선순위 쿼리에 유리)
  data_verified_at  timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ============================================================
-- foods 인덱스
-- ============================================================
create index foods_brand_idx        on foods (brand_id);
create index foods_protein_idx      on foods (protein_pct);
create index foods_carb_idx         on foods (carb_pct);
create index foods_verified_idx     on foods (data_verified_at);

-- 배열/JSON 검색을 위한 GIN 인덱스(검색 성능)
create index foods_caution_gin      on foods using gin (caution_ingredients);
create index foods_ingredients_gin  on foods using gin (ingredients);

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================
create or replace function set_updated_at() returns trigger as $$
begin
  -- Any update on foods will refresh updated_at
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger foods_updated_at
before update on foods
for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 리콜 (Recalls)
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - 리콜은 "제품행(food_id)"이 아니라 "브랜드/로트 단위"로 오는 경우가 많음
-- - 따라서 brand_id, food_id 둘 다 nullable로 연결
create table recalls (
  id            bigint generated always as identity primary key,

  -- 브랜드 참조: 삭제되면 연결 끊기
  brand_id      bigint references brands(id) on delete set null,

  -- 특정 food에 연결되는 경우에만 사용(선택)
  food_id       bigint references foods(id) on delete set null,

  -- 외부 소스 종류: openFDA / 검역본부 등
  source        text not null,

  -- 외부에서 확인 가능한 URL
  source_url    text not null,

  -- 외부 이벤트 ID(openFDA event_id 등)
  -- 중복 동기화 방지에 사용
  external_id   text,

  -- 리콜 주체
  recalling_firm text,

  -- 사유
  reason        text,

  -- 등급: Class I/II/III
  classification text,

  -- 영향을 받는 로트 정보(텍스트로 저장)
  affected_lots text,

  -- 리콜 날짜
  recall_date   date,

  -- 지역/국가 그룹: 'US' | 'KR'
  region        text,

  created_at    timestamptz not null default now(),

  -- 외부 소스와 external_id 조합은 유일해야(동기화 중복 방지)
  unique (source, external_id)
);

create index recalls_brand_idx on recalls (brand_id, recall_date desc);

-- ─────────────────────────────────────────────────────────────
-- 가격 (Prices) — 스키마만 미리 정의
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - price는 시간이 흐르며 변하므로 스냅샷을 누적(row per capture)하는 모델
-- - food_id 삭제 시 해당 가격 스냅샷도 같이 삭제(cascade)
create table prices (
  id             bigint generated always as identity primary key,

  food_id        bigint not null references foods(id) on delete cascade,

  retailer       text not null,         -- 판매처
  price          numeric(10,2) not null,
  price_per_100g numeric(10,2),       -- 100g 기준 단가(선택)

  url            text,                 -- 캡처 당시 상품 링크(선택)

  captured_at    timestamptz not null default now()
);

-- 최신 가격 조회를 빠르게 하려는 복합 인덱스
create index prices_food_idx on prices (food_id, captured_at desc);

-- ─────────────────────────────────────────────────────────────
-- 급여 기록 (Feeding)
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - cats(고양이)와 feeding_logs(급여 로그)를 분리
-- - feeding_logs는 ended_on이 NULL이면 현재 급여 중
create table cats (
  id          bigint generated always as identity primary key,

  -- 소유자: Supabase Auth user
  owner_id    uuid not null references auth.users(id) on delete cascade,

  name        text not null,
  birth_date  date,

  created_at  timestamptz not null default now()
);

create index cats_owner_idx on cats (owner_id);

create table feeding_logs (
  id          bigint generated always as identity primary key,

  cat_id      bigint not null references cats(id) on delete cascade,

  -- 급여 당시 사용된 food 참조
  -- 삭제되면 기록이 깨질 수 있으므로 restrict
  food_id     bigint not null references foods(id) on delete restrict,

  started_on  date not null,
  ended_on    date,                 -- null = 현재 급여 중

  note        text,
  created_at  timestamptz not null default now()
);

create index feeding_logs_cat_idx on feeding_logs (cat_id, started_on desc);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
-- 설계 의도:
-- - 카탈로그/리콜(foods, brands, recalls)은 공개 읽기만 허용
-- - 급여기록(cats, feeding_logs)은 owner만 접근
alter table foods    enable row level security;
alter table brands   enable row level security;
alter table recalls  enable row level security;
alter table cats         enable row level security;
alter table feeding_logs enable row level security;

-- ---------------------------
-- Public read: catalog/recalls
-- ---------------------------
-- using (true) => 조건 제한 없음(모두 select 가능)
create policy "public read foods"
  on foods for select using (true);

create policy "public read brands"
  on brands for select using (true);

create policy "public read recalls"
  on recalls for select using (true);

-- ---------------------------
-- Owner manage: cats
-- ---------------------------
-- for all:
-- - SELECT/INSERT/UPDATE/DELETE 등 모든 동작에 대해 policy 적용
-- using:
--   - row를 읽거나 수정/삭제할 때 owner 일치 여부 확인
-- with check:
--   - 새로 INSERT/UPDATE될 row가 owner 조건을 만족해야 허용
create policy "owner manages cats" on cats
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ---------------------------
-- Owner manage: feeding_logs
-- ---------------------------
-- feeding_logs는 feeding_logs.cat_id -> cats.id 를 통해 owner를 간접 참조
create policy "owner manages logs" on feeding_logs
  for all
  using (
    exists (
      select 1
      from cats
      where cats.id = feeding_logs.cat_id
        and cats.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from cats
      where cats.id = feeding_logs.cat_id
        and cats.owner_id = auth.uid()
    )
  );

-- ============================================================
-- End of schema
-- ============================================================
