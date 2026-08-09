// Pet Friends 상품 목록(pet-fritends.json) → 건사료 카탈로그 골격 적재.
//
// 적재 대상: brands + foods 골격(brand, product_name, weight_kg). 성분(영양)은
// 채우지 않는다 — 그것은 사람 큐레이터가 출처 태깅과 함께
// 별도로 채운다. 가격은 BLUEPRINT의 가격 보류 방침에 따라 적재하지 않는다.
//
// 이 파일은 "리서치 워크리스트"를 만든다: 사람이 검증할 성분 데이터의 입력 큐.
//
// 사용법(비밀은 저장소 밖에서 읽는다 — scripts/README.md 참고):
//   node scripts/ingest-petfriends.mjs --dry   # 미리보기(쓰기 없음)
//   node scripts/ingest-petfriends.mjs         # 실제 적재
//
// 멱등성: migration 0003의 (source, external_id)로 upsert한다.
//         기존 NULL 식별자 행은 추측으로 병합하지 않고 재적재에서 건너뛴다.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SECRETS_FILE, loadSecrets } from "./with-secrets.mjs";

const DRY = process.argv.includes("--dry");
const SOURCE = "pet_friends";

loadSecrets();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`Supabase URL/service key가 ${SECRETS_FILE}에 없습니다.`);
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 필터/정규화 ────────────────────────────────────────────────
const EXCLUDE =
  /파우치|캔|통조림|간식|츄르|챠오|스틱|트릿|샘플|체험|증정|습식|토퍼|영양제|보충|우유|음료|caviar|churu/i;

function parseWeightKg(name) {
  const m = name.match(/([0-9]+(?:\.[0-9]+)?)\s*kg/i);
  return m ? parseFloat(m[1]) : null;
}

// 기존 큐레이션 브랜드(영문)와 pet-friends 한글명을 병합하기 위한 별칭 맵.
// 같은 제조사가 언어 차이로 두 브랜드로 갈리는 것을 방지한다.
// 키는 정규화된 한글명(소문자), 값은 DB에 쓸 정규 브랜드명.
const BRAND_ALIASES = {
  아카나: "ACANA", // foods 테이블의 기존 큐레이션 브랜드(brand_id 1)와 병합
  레오나르도: "LEONARDO", // 큐레이션 브랜드(brand_id 108)와 병합 — 없으면 27/108로 갈린다
  오리젠: "ORIJEN", // ACANA와 같은 Champion Petfoods. 큐레이션 브랜드는 ASCII 표기를 정규명으로 쓴다
};

// 괄호 별칭 제거 → 정규 브랜드명. "로얄캐닌(Royal Canin)" / "로얄캐닌 (Royal Canin)" → "로얄캐닌"
function canonicalBrand(name) {
  const base = (name ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return BRAND_ALIASES[base.toLowerCase()] ?? base;
}

// 선행 프로모션 대괄호([창고대방출] 등) 제거 + 공백 정리
function cleanProductName(name) {
  return name
    .replace(/^\s*(\[[^\]]*\]\s*)+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isDryCatFood(p) {
  const kg = parseWeightKg(p.productName);
  return kg != null && kg >= 1.0 && !EXCLUDE.test(p.productName);
}

// ── 메인 ───────────────────────────────────────────────────────
const raw = JSON.parse(readFileSync("pet-fritends.json", "utf8"));
const products = raw
  .filter(isDryCatFood)
  .map((p) => ({
    externalId: String(p.productId),
    brand: canonicalBrand(p.brandName),
    productName: cleanProductName(p.productName),
    weightKg: parseWeightKg(p.productName),
  }))
  .filter((p) => p.brand && p.productName);

// 같은 productId 중복 제거
const byId = new Map(products.map((p) => [p.externalId, p]));
const items = [...byId.values()];
const brands = [...new Set(items.map((i) => i.brand))].sort();

console.log(
  `총 ${raw.length}개 중 건사료 ${items.length}개, 브랜드 ${brands.length}개`,
);
console.log("샘플:");
for (const i of items.slice(0, 8))
  console.log(`  ${i.weightKg}kg | ${i.brand} | ${i.productName}`);

console.log("external_id 컬럼: migration 0003 기준 upsert");

if (DRY) {
  console.log("\n[DRY RUN] 쓰기 없이 종료.");
  process.exit(0);
}

// 1) 브랜드 보장 (manufacturer NULL 기준 정규화 인덱스가 중복 막음)
const { data: existingBrands, error: be } = await supabase
  .from("brands")
  .select("id, name");
if (be) throw be;
const brandId = new Map(
  (existingBrands ?? []).map((b) => [b.name.toLowerCase(), b.id]),
);
const missingBrands = brands.filter((b) => !brandId.has(b.toLowerCase()));
if (missingBrands.length) {
  const { data: ins, error } = await supabase
    .from("brands")
    .insert(missingBrands.map((name) => ({ ko_name: name, name })))
    .select("id, name");
  if (error) throw error;
  for (const b of ins ?? []) brandId.set(b.name.toLowerCase(), b.id);
}
console.log(`브랜드: 신규 ${missingBrands.length}, 총 ${brandId.size}`);

// 2) foods 행 구성
// 오븐베이크·동결건조를 이름으로 드러내는 제품. 이것만 조리법 미상으로 남긴다.
const NON_EXTRUSION =
  /오븐|베이크|bake|동결|프리즈|freeze|에어드라이|air.?dried|화식|저온/i;

const rows = items.map((i) => {
  return {
    brand_id: brandId.get(i.brand.toLowerCase()),
    // 중량은 weight_kg가 든다. 이름에 남기면 같은 레시피가 포장 수만큼 다른
    // 제품으로 보이고, 조사도 그만큼 중복된다.
    product_name: i.productName
      .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g)/gi, "")
      .replace(/\s+/g, " ")
      .trim(),
    weight_kg: i.weightKg,
    source: SOURCE,
    external_id: i.externalId,
    // 위 필터가 이미 건사료만 남겼고 건식 킵블은 익스트루전이다. 이걸 비워두면
    // resolveAsh의 9.0% 폴백이 막혀, 회분을 표기하지 않는 AAFCO 계열 브랜드가
    // 통째로 carb null인 빈 껍데기가 된다. 폴백값은 estimated로 태깅돼 나간다.
    cooking_method:
      NON_EXTRUSION.test(i.productName) || NON_EXTRUSION.test(i.brand)
        ? null
        : "extrusion",
  };
});

let inserted = 0;
let skipped = 0;
const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, k) =>
    arr.slice(k * n, k * n + n),
  );

const { data: legacyRows, error: legacyError } = await supabase
  .from("foods")
  .select("brand_id, product_name")
  .is("source", null)
  .is("external_id", null);
if (legacyError) throw legacyError;
const legacyKeys = new Set(
  (legacyRows ?? []).map((row) => `${row.brand_id}\u0000${row.product_name}`),
);
const fresh = rows.filter((row) => {
  const key = `${row.brand_id}\u0000${row.product_name}`;
  if (!legacyKeys.has(key)) return true;
  skipped++;
  return false;
});

for (const batch of chunk(fresh, 500)) {
  const { data, error } = await supabase
    .from("foods")
    .upsert(batch, {
      onConflict: "source,external_id",
      ignoreDuplicates: false,
    })
    .select("id");
  if (error) throw error;
  inserted += data?.length ?? 0;
}

console.log(
  `\n적재 완료 — foods inserted/upserted: ${inserted}, skipped(existing): ${skipped}`,
);
