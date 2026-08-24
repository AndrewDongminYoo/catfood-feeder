// 발행된 사료 중, 현재 소스의 보관 캡처가 "그 제품의" 원재료 나열을 담고 있는
// 건수를 센다. 모델은 호출하지 않는다 — 이 단계의 산출물은 숫자다.
//
// 식별을 어떻게 확인하는가:
//   1. 쉼표로 8개 이상 이어지는 나열만 후보로 본다. 사이트 내비게이션 문구는
//      이 밀도가 나오지 않으므로, 이 조건 하나가 "Limited Ingredients Grain Free"
//      류의 마커 오탐을 이미 걸러낸다.
//   2. 캡처 하나에 나열이 여럿이면 첫 매치를 고르는 것은 동전 던지기다. 개수로
//      두 무리를 가른다: 나열이 하나면 A, 여럿이면 B.
//   3. product_name 은 한국어이고 캡처는 대부분 영어라 제품명 토큰은 쓸 수 없다.
//      영어 제품 식별자는 소스 URL 슬러그가 들고 있으므로 그쪽을 본다.
//
// 이 스크립트가 증명하지 못하는 것 (2026-08-23, 표본 14건 손으로 읽음):
//   A 무리 10건 중 7건은 진짜 목록, 2건은 허브 괄호 하위목록만, 1건은 마케팅 문구
//   오탐이었다. B 무리는 첫 매치가 내비게이션 문구인 경우가 섞인다. 남은 실패는
//   문법이 아니라 의미라서 정규식으로는 못 가른다. 그러므로 이 출력은 후보를
//   추리고 순서를 매길 뿐이고, 식별과 완전성은 추출 패스가 판정한다.
import { loadSecrets } from "./with-secrets.mjs";

loadSecrets();

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY)
  throw new Error("Supabase 자격 증명을 찾을 수 없습니다.");

const HEADERS = { Authorization: `Bearer ${KEY}`, apikey: KEY };

// 최소 8개 항목이 쉼표로 이어지는 구간.
//
// 항목 문자셋을 좁게 잡으면 안 된다. "chicken fat (preserved with tocopherols and
// citric acid)" 같은 긴 괄호 항목에서 체인이 끊겨 목록 하나가 여러 개로 쪼개지고,
// 그 조각 수가 "한 페이지에 제품이 여럿"이라는 모호도로 잘못 읽힌다. 실제로 상한을
// 40자로 뒀을 때 125건 중 62건이 그렇게 보고됐다. 쉼표·세미콜론·줄바꿈만 항목
// 경계로 쓰고 나머지는 통과시킨다.
const RUN = /(?:[^\s,;:\n][^,;:\n]{2,90}, ){7,}[^\s,;:\n][^,;:\n]{2,90}/g;

/** URL 구조어와 종·형태 일반명. 이것만 남으면 식별에 쓸 수 없다. */
const GENERIC = new Set([
  "and",
  "cat",
  "cats",
  "co",
  "com",
  "de",
  "dry",
  "en",
  "es",
  "food",
  "foods",
  "for",
  "fr",
  "html",
  "index",
  "it",
  "kitten",
  "kr",
  "net",
  "org",
  "pet",
  "pets",
  "php",
  "product",
  "products",
  "recipe",
  "recipes",
  "the",
  "with",
  "www",
  "your",
]);

/** 브랜드명과 URL 슬러그에서 식별에 쓸 만한 토큰만 남긴다. */
function identityTokens(brand, url) {
  let path = url;
  try {
    path = new global.URL(url).pathname;
  } catch {
    // 파싱 실패는 원본 문자열로 대체한다 — 토큰이 조금 늘 뿐 해롭지 않다.
  }
  return [
    ...new Set(
      `${brand ?? ""} ${path}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(
          (token) =>
            token.length > 2 && !/^\d+$/.test(token) && !GENERIC.has(token),
        ),
    ),
  ];
}

/** 같은 목록이 모바일·데스크톱 DOM 에 두 번 실리는 경우를 한 건으로 센다. */
function distinctRuns(text) {
  const seen = new Map();
  for (const match of text.matchAll(RUN)) {
    const key = match[0].slice(0, 60).toLowerCase().replace(/\s+/g, " ");
    if (!seen.has(key)) seen.set(key, { index: match.index, run: match[0] });
  }
  return [...seen.values()];
}

async function rest(query, label) {
  const response = await fetch(`${URL_BASE}/rest/v1/${query}`, {
    headers: HEADERS,
  });
  if (!response.ok) throw new Error(`${label} 조회 실패: ${response.status}`);
  return response.json();
}

const foods = await rest(
  "foods?select=id,product_name,brands(name)&published_at=not.is.null&order=id",
  "foods",
);

const noRun = [];
const single = [];
const multiple = [];

for (const food of foods) {
  const sources = await rest(
    `food_sources?select=id,url,captured_text&food_id=eq.${food.id}&is_current=is.true&fetch_status=eq.fetched`,
    "food_sources",
  );

  let best = null;
  for (const source of sources) {
    const text = source.captured_text ?? "";
    const runs = distinctRuns(text);
    if (runs.length === 0) continue;
    const tokens = identityTokens(food.brands?.name, source.url ?? "");
    const window = text
      .slice(Math.max(0, runs[0].index - 300), runs[0].index)
      .toLowerCase();
    const found = tokens.filter((token) => window.includes(token));
    // 나열이 하나뿐인 소스를 우선한다 — 모호도가 낮은 쪽이 좋은 후보다.
    if (!best || runs.length < best.runs.length) {
      best = { found, runs, sourceId: source.id, url: source.url };
    }
  }

  if (!best) noRun.push({ food });
  else if (best.runs.length === 1) single.push({ food, ...best });
  else multiple.push({ food, ...best });
}

const withToken = single.filter((row) => row.found.length > 0);

console.log(`published:              ${foods.length}`);
console.log(`no comma run:           ${noRun.length}`);
console.log(`tranche A (one run):    ${single.length}`);
console.log(`  ...with a slug token: ${withToken.length}`);
console.log(`tranche B (several):    ${multiple.length}`);

function sample(rows, title, count) {
  console.log(`\n--- ${title} ---`);
  for (const row of rows.slice(0, count)) {
    console.log(`\n[${row.food.id}] ${row.food.product_name}`);
    console.log(`  source: ${row.sourceId}`);
    console.log(`  url:    ${row.url}`);
    console.log(`  runs:   ${row.runs.length}`);
    console.log(`  tokens: ${row.found.join(", ") || "(none)"}`);
    console.log(`  run:    ${row.runs[0].run.slice(0, 150)}`);
  }
}

sample(single, "무리 A 표본 10건 (손으로 검증)", 10);
sample(multiple, "무리 B 표본 5건", 5);

const ids = (rows) => rows.map((row) => row.food.id).join(",");
const targets = (rows) =>
  rows.map((row) => `${row.food.id}:${row.sourceId}`).join(",");
console.log(`\ntranche A ids: ${ids(single)}`);
console.log(`\ntranche B ids: ${ids(multiple)}`);
console.log(`\ntranche A targets: ${targets(single)}`);
console.log(`\ntranche B targets: ${targets(multiple)}`);
