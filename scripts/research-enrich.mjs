// 리서치 에이전트 — 스켈레톤 foods 행의 성분을 출처 태깅으로 채운다.
//
// 파이프라인(ingest-petfriends.mjs가 만든 워크리스트 위에서 동작):
//   1) 대상 제품을 고른다 (성분 미입력 = protein_pct null인 행).
//   2) Claude + web_search로 "제조사 보장성분(GA) 원문"과 "국내 수입 라벨 원문"을
//      실제 웹에서 검색해 가져온다. (메모리에서 수치를 지어내지 않는다.)
//   3) 가져온 텍스트에서만 근거 구절(evidence)이 있는 값을 추출하고 출처(source)를
//      태깅한다. 근거 없으면 value/source = null (환각 방지) — /api/extract와 동일 규율.
//   4) DRAFT로 기록: 측정값 + nutrient_sources만 쓰고 data_verified_at은 null로 둔다
//      (기계 추출 ≠ 사람 검증). NFE/열량비 등 파생값은 사람 검토 후 도메인 로직이 계산.
//
// 사용법:
//   node --env-file=.env.local scripts/research-enrich.mjs --name "오리젠"        # dry, 1건
//   node --env-file=.env.local scripts/research-enrich.mjs --id 42 --write        # 실제 기록
//   node --env-file=.env.local scripts/research-enrich.mjs --limit 3              # dry, 3건 샘플
//
// 기본은 dry-run(쓰기 없음). --write 플래그가 있어야 DB에 DRAFT를 기록한다.

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};
const WRITE = args.includes("--write");
const NAME = flag("--name");
const ID = flag("--id");
const LIMIT = parseInt(flag("--limit") ?? "1", 10);
const MODEL = "claude-sonnet-4-6"; // /api/extract와 동일 tier (고볼륨 추출에 적합)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!supabaseUrl || !supabaseKey || !apiKey) {
  console.error("환경변수 누락: SUPABASE URL/key, ANTHROPIC_API_KEY 확인.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const NUTRIENT_KEYS = [
  "protein_pct",
  "fat_pct",
  "fiber_pct",
  "ash_pct",
  "moisture_pct",
  "calcium_pct",
  "phosphorus_pct",
  "kcal_per_kg",
];

const SCHEMA = `{
  "cooking_method": "extrusion"|"baked"|"freeze_dried"|"dried"|null,
  "nutrients": {
    ${NUTRIENT_KEYS.map(
      (k) =>
        `"${k}": {"value": number|null, "evidence": string|null, "source": "manufacturer"|"kr_label"|null}`,
    ).join(",\n    ")}
  },
  "sources_checked": [ {"url": string, "kind": "manufacturer"|"kr_label"} ]
}`;

function buildPrompt(brand, productName, weightKg) {
  return `You are a pet-food label data researcher. Use web_search to find OFFICIAL nutrient data for this product, then extract it.

PRODUCT: ${brand} — ${productName}${weightKg ? ` (${weightKg}kg)` : ""}

STEPS:
1. Search the web for two things: (a) the MANUFACTURER's guaranteed analysis / 보장성분 (often English: "Crude Protein (min) ...%"), and (b) the KOREAN importer label (국내 수입 라벨: "조단백 ...% 이상, 조회분 ...% 이하" etc.). Prefer the manufacturer's official site and Korean retailer/importer pages.
2. Extract guaranteed-analysis values ONLY from text you actually retrieved.

CRITICAL RULES (anti-hallucination — identical to the app's /api/extract):
- For every value you MUST include the exact source phrase you saw in "evidence". If a value is not literally present in retrieved text, set value, evidence, AND source to null. NEVER guess or infer a number from memory.
- Percentages: strip the % sign, number only ("Crude Protein (min) 36.0%" -> 36.0).
- Tag "source": "manufacturer" if it came from the manufacturer's text, "kr_label" if from the Korean importer label. Manufacturer text usually omits ash (회분) and energy; the KR label usually has them.
- Prefer manufacturer values for protein/fat/fiber/moisture/calcium/phosphorus; use kr_label to fill what's missing (typically ash, kcal).
- Do NOT compute carbohydrate/NFE or energy ratios. Only extract values literally on the labels.
- cooking_method: infer only if clearly stated.
- List the pages you used in "sources_checked".

Return ONLY the JSON object, no markdown, no preamble.

Schema:
${SCHEMA}`;
}

async function research(brand, productName, weightKg) {
  const body = {
    model: MODEL,
    max_tokens: 4000,
    tools: [{ type: "web_search_20260209", name: "web_search" }],
    messages: [
      { role: "user", content: buildPrompt(brand, productName, weightKg) },
    ],
  };

  // 서버측 web_search가 반복 한도에 걸리면 pause_turn → 최대 2회 이어서 호출
  let messages = body.messages;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ ...body, messages }),
    });
    if (!res.ok)
      throw new Error(
        `Claude ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    const data = await res.json();
    if (data.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: data.content }];
      continue;
    }
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  }
  throw new Error("web_search가 계속 pause_turn — 중단");
}

// ── 대상 선택 ──────────────────────────────────────────────────
let q = supabase
  .from("foods")
  .select("id, product_name, weight_kg, brand_id, brands:brand_id (name)")
  .is("protein_pct", null); // 스켈레톤(미입력)만
if (ID) q = q.eq("id", Number(ID));
else if (NAME) q = q.ilike("product_name", `%${NAME}%`);
q = q.limit(LIMIT);

const { data: targets, error } = await q;
if (error) throw error;
if (!targets?.length) {
  console.log("대상 행이 없습니다 (조건에 맞는 스켈레톤 foods 없음).");
  process.exit(0);
}

console.log(
  `대상 ${targets.length}건 · 모델 ${MODEL} · ${WRITE ? "WRITE" : "DRY-RUN"}\n`,
);

for (const f of targets) {
  const brand = f.brands?.name ?? "";
  console.log(`▶ [${f.id}] ${brand} — ${f.product_name}`);
  try {
    const r = await research(brand, f.product_name, f.weight_kg);
    const found = NUTRIENT_KEYS.filter((k) => r.nutrients?.[k]?.value != null);
    console.log(
      `  추출: ${found.map((k) => `${k}=${r.nutrients[k].value}(${r.nutrients[k].source})`).join(", ") || "(근거 있는 값 없음)"}`,
    );
    if (r.sources_checked?.length)
      console.log(
        `  출처: ${r.sources_checked
          .map((s) => s.url)
          .join(" , ")
          .slice(0, 200)}`,
      );

    if (WRITE && found.length) {
      const patch = { nutrient_sources: {} };
      for (const k of found) {
        patch[k] = r.nutrients[k].value;
        patch.nutrient_sources[k] = r.nutrients[k].source;
      }
      if (r.cooking_method) patch.cooking_method = r.cooking_method;
      // data_verified_at은 일부러 건드리지 않는다(기계 추출 = 미검증 DRAFT).
      const { error: ue } = await supabase
        .from("foods")
        .update(patch)
        .eq("id", f.id);
      if (ue) throw ue;
      console.log(
        `  → DRAFT 기록 (data_verified_at은 null 유지, 사람 검토 대기)`,
      );
    } else if (!WRITE) {
      console.log(`  (dry-run — 기록하지 않음)`);
    }
  } catch (e) {
    console.log(`  ✗ 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
}
