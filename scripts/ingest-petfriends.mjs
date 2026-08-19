// Pet Friends 상품 목록(pet-friends.json) → 건사료 카탈로그 골격 적재.
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
import { selectAll } from "./select-all.mjs";
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

/**
 * 리스팅 이름에서 레시피 이름을 뽑는다. 중량은 weight_kg가 들고, 포장 수량(24ea)도
 * 레시피가 아니다.
 *
 * 중량을 지우고 끝내면 감싸던 기호가 남는다 — "(454g/1.5kg)"는 "(/)"가, "(50g*24ea)"는
 * "(*24ea)"가 된다. 반대로 꼬리 기호를 몰아서 지우면 "7세+"의 +와 "(민감)"의 닫는
 * 괄호까지 사라지므로, 고아가 된 것만 지운다.
 */
function recipeName(name) {
  return name
    .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g)/gi, "")
    .replace(/\s*\(\s*[*x\u00d7]?\s*[0-9]*\s*ea\s*\)/gi, "")
    .replace(/\s*\(\s*[/*x\u00d7,+\u00b7\s-]*\s*\)/g, "")
    .replace(/\s*[*x\u00d7]\s*[0-9]+\s*ea\s*$/gi, "")
    .replace(/\s+/g, " ")
    .replace(/[\s/,\u00b7-]+$/g, "")
    .trim();
}

// ── 메인 ───────────────────────────────────────────────────────
const raw = JSON.parse(readFileSync("pet-friends.json", "utf8"));
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

// 1) 브랜드 보장 (manufacturer NULL 기준 정규화 인덱스가 중복 막음)
// PostgREST는 1000행을 넘기면 잘라서 돌려주고 오류를 내지 않는다 — 잘리면 이미
// 있는 브랜드를 없는 것으로 보고 다시 만들려 시도한다. 그때는 정규화 인덱스가
// 막아 조용히 틀리진 않지만(insert가 에러로 죽는다), 페이지네이션이 애초에 그
// 상황 자체를 없앤다. scripts/select-all.mjs 참고.
const existingBrands = await selectAll((from, to) =>
  supabase
    .from("brands")
    .select("id, name, ko_name, in_scope")
    .order("id")
    .range(from, to),
);
// 한글명과 정식명을 모두 키로 넣는다. 이 목록은 한글 브랜드명을 주는데, 이전 세션이
// brands.name 을 정식 영문명으로 바꾸고 한글을 ko_name 으로 분리해서, name 만 보면
// 107개 중 89개가 "없는 브랜드"로 읽히고 중복 생성된다.
const brandId = new Map();
for (const b of existingBrands) {
  brandId.set(b.name.toLowerCase(), b.id);
  if (b.ko_name) brandId.set(b.ko_name.toLowerCase(), b.id);
}
// 스코프에서 뺀 브랜드는 골격을 다시 만들지 않는다. 이 목록은 소매 목록이라 카탈로그가
// 싣기로 한 것보다 넓고, 필터가 없으면 다음 실행이 지운 행을 그대로 되살린다.
const outOfScope = new Set();
for (const b of existingBrands.filter((brand) => !brand.in_scope)) {
  outOfScope.add(b.name.toLowerCase());
  if (b.ko_name) outOfScope.add(b.ko_name.toLowerCase());
}
const missingBrands = brands.filter(
  (b) => !brandId.has(b.toLowerCase()) && !outOfScope.has(b.toLowerCase()),
);

// 미리보기는 스코프를 읽은 뒤에 멈춘다. 그 전에 끊으면 "무엇을 건너뛰는가"가 보이지
// 않아, 미리보기를 통과한 뒤 실제 실행에서만 드러나는 차이가 생긴다.
if (DRY) {
  const skippedByScope = items.filter((i) =>
    outOfScope.has(i.brand.toLowerCase()),
  );
  console.log(
    `\n스코프 제외 브랜드 ${outOfScope.size}개 / 건너뛸 제품 ${skippedByScope.length}개`,
  );
  console.log(`신규 브랜드 예정 ${missingBrands.length}개`);
  console.log("\n[DRY RUN] 쓰기 없이 종료.");
  process.exit(0);
}
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

const inScopeItems = items.filter(
  (i) => !outOfScope.has(i.brand.toLowerCase()),
);
const droppedByScope = items.length - inScopeItems.length;

const rows = inScopeItems.map((i) => {
  return {
    brand_id: brandId.get(i.brand.toLowerCase()),
    // 중량은 weight_kg가 든다. 이름에 남기면 같은 레시피가 포장 수만큼 다른
    // 제품으로 보이고, 조사도 그만큼 중복된다.
    product_name: recipeName(i.productName),
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

// 완전해야 한다 — 잘리면 이미 손으로 큐레이션된 사료를 legacyKeys가 못 보고,
// 아래 필터가 그걸 다시 골격으로 적재해 중복 행을 만든다. scripts/select-all.mjs 참고.
const legacyRows = await selectAll((from, to) =>
  supabase
    .from("foods")
    .select("brand_id, product_name")
    .is("source", null)
    .is("external_id", null)
    .order("id")
    .range(from, to),
);
const legacyKeys = new Set(
  legacyRows.map((row) => `${row.brand_id}\u0000${row.product_name}`),
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
  `\n적재 완료 — foods inserted/upserted: ${inserted}, skipped(existing): ${skipped}` +
    `, skipped(out of scope): ${droppedByScope}`,
);
