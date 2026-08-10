#!/usr/bin/env node
// 근거를 하나도 남기지 못한 현재 출처를 은퇴시켜, 그 사료를 다시 조사 대상으로 돌린다.
//
// 왜 필요한가: 수집은 성공했는데 추출이 실패하면(추출 API 장애, 성분표가 없는 페이지)
// 그 사료는 현재 출처를 가진 채 근거가 0건인 상태로 남는다. 그러면 에이전트 경로는
// "skeleton이 아니다"라며 거절하고, 큐레이터 경로는 추출이 죽어 있으면 진행이 안 되어
// 두 경로 모두 닿지 못한다. Anthropic 크레딧이 떨어진 동안 62건이 이렇게 고였다.
//
// 삭제하지 않는다. `is_current = false`로 내려 원장은 그대로 두므로, 그 URL을 시도했다는
// 사실과 실패 이유는 남는다 — 그게 재조사를 더 낫게 만드는 재료다.
//
// 근거가 붙은 출처는 건드리지 않는다. 그 출처를 내리면 발행 시점 근거 검사가
// `source.is_current`를 조인하므로 성공한 조사 결과가 통째로 무효가 된다.
//
// 판정은 사료가 아니라 출처(source_id) 단위다. 한 사료가 근거 있는 manufacturer
// 출처와 근거 없는 kr_label 출처를 동시에 현재로 갖는 경우가 있다 — 예를 들어
// 라벨 전사 승인이 근거 적용 단계에서 실패하면 그렇게 된다. food_id로만 판정하면
// manufacturer 쪽 근거가 kr_label 쪽의 좌초를 가려 영영 좌초로 남는다.
//
// 사용법:
//   node scripts/release-stranded.mjs --dry
//   node scripts/release-stranded.mjs

import { createClient } from "@supabase/supabase-js";
import { selectAll } from "./select-all.mjs";
import { SECRETS_FILE, loadSecrets } from "./with-secrets.mjs";

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
const DRY = process.argv.includes("--dry");

// 이 조회도 완전해야 한다 — 잘리면 좌초 출처 일부가 영영 회수되지 않고, 위에
// 찍히는 "현재 출처 N건"도 틀린 수가 된다.
const sources = await selectAll((from, to) =>
  supabase
    .from("food_sources")
    .select("id, food_id, kind, url, failure_code, foods!inner(published_at)")
    .eq("is_current", true)
    .is("foods.published_at", null)
    .order("id")
    .range(from, to),
);

// PostgREST caps a plain .select() at 1000 rows with no error — this table crossed
// that (1501 rows, 2026-08-10) and a bare query here silently missed 501 backed
// sources, which then got retired as "stranded". Paginate so `backed` is always
// complete regardless of table size. See scripts/select-all.mjs.
const evidence = await selectAll((from, to) =>
  supabase
    .from("food_nutrient_evidence")
    .select("source_id")
    .eq("is_current", true)
    .order("id")
    .range(from, to),
);

const backed = new Set(evidence.map((row) => row.source_id));
const stranded = sources.filter((row) => !backed.has(row.id));

console.log(
  `현재 출처 ${sources.length}건 중 근거 없는 좌초 ${stranded.length}건`,
);
if (stranded.length === 0) process.exit(0);

for (const row of stranded.slice(0, 20)) {
  console.log(
    `  ${row.food_id} ${row.kind} ${row.failure_code ?? "fetched"} ${String(row.url).slice(0, 60)}`,
  );
}
if (stranded.length > 20) console.log(`  … 외 ${stranded.length - 20}건`);

if (DRY) {
  console.log("\n[DRY RUN] 변경 없음.");
  process.exit(0);
}

const { error: updateError } = await supabase
  .from("food_sources")
  .update({ is_current: false })
  .in(
    "id",
    stranded.map((row) => row.id),
  );
if (updateError) throw updateError;

console.log(
  `\n${stranded.length}건을 현재 출처에서 내렸다. 다시 조사 대상이다.`,
);
