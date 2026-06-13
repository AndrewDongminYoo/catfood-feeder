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
CREATE TYPE nutrient_source AS ENUM ('manufacturer', 'kr_label', 'estimated', 'derived');

-- ============================================================
-- Enum: 제조/가공 방식도 고정 선택지로 관리
-- ============================================================
-- cooking_method: 제조법(열/가공 공정)
CREATE TYPE cooking_method AS ENUM ('extrusion', 'baked', 'freeze_dried', 'dried');

-- ─────────────────────────────────────────────────────────────
-- 브랜드 / 제조사 / 수입사
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - importer(수입사)는 변경이 잦을 수 있으므로 nullable.
-- - 식별의 축은 (name + manufacturer)로 잡음.
CREATE TABLE brands (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- 브랜드명 (e.g. ACANA)
  name          text NOT NULL,

  -- 제조사 (e.g. Champion Petfoods) — 식별에 중요
  manufacturer  text,

  -- 국내 수입사 (변경 잦음) — 식별 축이 아님
  importer      text,

  -- 원산지
  country       text,

  -- 제조/브랜드 홈 URL (선택)
  homepage_url  text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  -- 같은 이름이라도 manufacturer가 다르면 다른 레코드로 취급
  UNIQUE (name, manufacturer)
);

CREATE UNIQUE INDEX brands_name_manufacturer_normalized_idx
  ON brands (lower(name), coalesce(lower(manufacturer), ''));

-- ─────────────────────────────────────────────────────────────
-- 사료 제품: foods
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - label/문서에서 들어오는 "보장성분"을 numeric으로 평탄하게 저장
--   -> 필터/정렬/범위쿼리에 유리
-- - carb_pct, energy ratios 등은 추정/역산 여부를 함께 관리
-- - ca_p_ratio 같은 반복 계산은 generated stored로 DB가 관리
CREATE TABLE foods (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- foods는 brands에 종속(브랜드 삭제는 막음)
  brand_id        bigint NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,

  -- 제품명 (예: Duck & Potato)
  product_name    text NOT NULL,

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
  carb_is_estimated  boolean NOT NULL DEFAULT false,

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
  ca_p_ratio      numeric(5,3) GENERATED ALWAYS AS (
                    CASE WHEN calcium_pct IS NOT null AND calcium_pct > 0
                         AND phosphorus_pct IS NOT null
                    THEN round(phosphorus_pct / calcium_pct, 3)
                    END
                  ) STORED,

  -- ==========================================================
  -- 각 성분 값의 출처 메타데이터
  -- ==========================================================
  -- {"protein_pct":"manufacturer","ash_pct":"kr_label","energy_p_pct":"manufacturer", ...}
  -- 이 JSON을 통해 "추정/실측/역산"을 섞지 않도록 관리
  nutrient_sources jsonb NOT NULL DEFAULT '{}',

  -- 원료 목록 (구조가 유동적일 수 있어 JSONB 선택)
  -- 예: [{"name":"Duck","pct":null,"type":"meat"}, ...]
  ingredients     jsonb NOT NULL DEFAULT '[]',

  -- 기능성 플래그 (빠른 필터링)
  grain_free      boolean NOT NULL DEFAULT false,
  meal_free       boolean NOT NULL DEFAULT false,
  has_probiotics  boolean NOT NULL DEFAULT false,
  has_cranberry   boolean NOT NULL DEFAULT false,
  has_yucca       boolean NOT NULL DEFAULT false,

  -- 위험성분(라벨 미표기/사후 검출 등): 검색 가치 낮음 -> 부가정보로만 저장
  caution_ingredients text[] NOT NULL DEFAULT '{}',

  -- ==========================================================
  -- 출처/검증 관련 링크/시간
  -- ==========================================================
  manufacturer_url  text,            -- 제조사 성분표/문서 URL
  kr_label_source   text,           -- 국내 라벨 출처(수입사명/이미지 등)

  -- 사람이 마지막으로 검증한 시점 (갱신 우선순위 쿼리에 유리)
  data_verified_at  timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- foods 인덱스
-- ============================================================
CREATE INDEX foods_brand_idx        ON foods (brand_id);
CREATE INDEX foods_protein_idx      ON foods (protein_pct);
CREATE INDEX foods_carb_idx         ON foods (carb_pct);
CREATE INDEX foods_verified_idx     ON foods (data_verified_at);
CREATE INDEX foods_filter_idx       ON foods (grain_free, cooking_method, protein_pct);

-- 배열/JSON 검색을 위한 GIN 인덱스(검색 성능)
CREATE INDEX foods_caution_gin      ON foods USING gin (caution_ingredients);
CREATE INDEX foods_ingredients_gin  ON foods USING gin (ingredients);

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
begin
  -- Any update on foods will refresh updated_at
  new.updated_at = now();
  return new;
end;
$$ LANGUAGE plpgsql;

CREATE TRIGGER foods_updated_at
BEFORE UPDATE ON foods
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 리콜 (Recalls)
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - 리콜은 "제품행(food_id)"이 아니라 "브랜드/로트 단위"로 오는 경우가 많음
-- - 따라서 brand_id, food_id 둘 다 nullable로 연결
CREATE TABLE recalls (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- 브랜드 참조: 삭제되면 연결 끊기
  brand_id      bigint REFERENCES brands(id) ON DELETE SET NULL,

  -- 특정 food에 연결되는 경우에만 사용(선택)
  food_id       bigint REFERENCES foods(id) ON DELETE SET NULL,

  -- 외부 소스 종류: openFDA / 검역본부 등
  source        text NOT NULL,

  -- 외부에서 확인 가능한 URL
  source_url    text NOT NULL,

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

  created_at    timestamptz NOT NULL DEFAULT now(),

  -- 외부 소스와 external_id 조합은 유일해야(동기화 중복 방지)
  UNIQUE (source, external_id)
);

CREATE INDEX recalls_brand_idx ON recalls (brand_id, recall_date DESC);

-- ─────────────────────────────────────────────────────────────
-- 가격 (Prices) — 스키마만 미리 정의
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - price는 시간이 흐르며 변하므로 스냅샷을 누적(row per capture)하는 모델
-- - food_id 삭제 시 해당 가격 스냅샷도 같이 삭제(cascade)
CREATE TABLE prices (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  food_id        bigint NOT NULL REFERENCES foods(id) ON DELETE CASCADE,

  retailer       text NOT NULL,         -- 판매처
  price          numeric(10,2) NOT NULL,
  price_per_100g numeric(10,2),       -- 100g 기준 단가(선택)

  url            text,                 -- 캡처 당시 상품 링크(선택)

  captured_at    timestamptz NOT NULL DEFAULT now()
);

-- 최신 가격 조회를 빠르게 하려는 복합 인덱스
CREATE INDEX prices_food_idx ON prices (food_id, captured_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 급여 기록 (Feeding)
-- ─────────────────────────────────────────────────────────────
-- 설계 의도:
-- - cats(고양이)와 feeding_logs(급여 로그)를 분리
-- - feeding_logs는 ended_on이 NULL이면 현재 급여 중
CREATE TABLE cats (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- 소유자: Supabase Auth user
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name        text NOT NULL,
  birth_date  date,

  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cats_owner_idx ON cats (owner_id);

CREATE TABLE feeding_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  cat_id      bigint NOT NULL REFERENCES cats(id) ON DELETE CASCADE,

  -- 급여 당시 사용된 food 참조
  -- 삭제되면 기록이 깨질 수 있으므로 restrict
  food_id     bigint NOT NULL REFERENCES foods(id) ON DELETE RESTRICT,

  started_on  date NOT NULL,
  ended_on    date,                 -- null = 현재 급여 중

  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feeding_logs_cat_idx ON feeding_logs (cat_id, started_on DESC);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
-- 설계 의도:
-- - 카탈로그/리콜(foods, brands, recalls)은 공개 읽기만 허용
-- - 급여기록(cats, feeding_logs)은 owner만 접근
ALTER TABLE foods    ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands   ENABLE ROW LEVEL SECURITY;
ALTER TABLE recalls  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeding_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------
-- Public read: catalog/recalls
-- ---------------------------
-- using (true) => 조건 제한 없음(모두 select 가능)
CREATE POLICY "public read foods"
  ON foods FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "public read brands"
  ON brands FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "public read recalls"
  ON recalls FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "public read prices"
  ON prices FOR SELECT
  TO anon, authenticated
  USING (true);

-- ---------------------------
-- Owner manage: cats
-- ---------------------------
-- for all:
-- - SELECT/INSERT/UPDATE/DELETE 등 모든 동작에 대해 policy 적용
-- using:
--   - row를 읽거나 수정/삭제할 때 owner 일치 여부 확인
-- with check:
--   - 새로 INSERT/UPDATE될 row가 owner 조건을 만족해야 허용
CREATE POLICY "owner manages cats" ON cats
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = owner_id)
  WITH CHECK ((SELECT auth.uid()) = owner_id);

-- ---------------------------
-- Owner manage: feeding_logs
-- ---------------------------
-- feeding_logs는 feeding_logs.cat_id -> cats.id 를 통해 owner를 간접 참조
CREATE POLICY "owner manages logs" ON feeding_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM cats
      WHERE cats.id = feeding_logs.cat_id
        AND cats.owner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM cats
      WHERE cats.id = feeding_logs.cat_id
        AND cats.owner_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- End of schema
-- ============================================================
