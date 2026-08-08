// 알려진 출처 URL 하나를 사료에 붙여 DRAFT까지 끌고 간다: 등록 → 추출 → 적용.
//
// research-run.mjs와 역할이 다르다. 저쪽은 codex가 URL을 **찾는** 경로이고, 이쪽은
// URL을 이미 아는 경우(제조사 사이트를 브랜드 단위로 훑을 때)의 경로다. 둘 다 서버가
// 다시 수집하고 근거를 문자 그대로 재검증한 뒤에만 값을 쓴다.
//
// 발행은 하지 않는다 — 그건 사람 게이트다(턴어라운드 문서). 이 스크립트가 끝난 사료는
// 근거가 붙은 비공개 DRAFT 상태로 어드민 검토를 기다린다.
//
// 사용법:
//   node scripts/curate-source.mjs --food 95 --url https://... [--kind manufacturer]
//
// 필요: ADMIN_WRITE_SECRET (~/.config/catfood-feeder/env), 로컬에 뜬 앱.

import { loadSecrets, SECRETS_FILE } from "./with-secrets.mjs";

loadSecrets();

const BASE = process.env.RESEARCH_BROKER_URL ?? "http://localhost:3000";
const secret = process.env.ADMIN_WRITE_SECRET;
if (!secret) {
  console.error(`ADMIN_WRITE_SECRET가 ${SECRETS_FILE}에 없습니다.`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const foodId = Number(arg("food"));
const url = arg("url");
const kind = arg("kind") ?? "manufacturer";
if (!Number.isInteger(foodId) || foodId <= 0 || !url) {
  console.error(
    "usage: node scripts/curate-source.mjs --food <id> --url <url>",
  );
  process.exit(1);
}

async function call(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-admin-secret": secret },
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${path} → ${response.status} ${payload.error ?? "(본문 없음)"}`,
    );
  }
  return payload;
}

// 수집 실패는 422로 오고 실패 자체가 원장에 남는다(sourceId를 돌려준다).
const registered = await call(`/api/foods/${foodId}/sources`, {
  captureMethod: "fetch",
  kind,
  url,
});
const sourceId = registered.source?.id;
if (!sourceId) throw new Error(`출처 등록 응답에 source.id가 없습니다`);
console.log(`수집 완료 source=${sourceId} (${registered.contentStatus})`);

const { candidates = [] } = await call(`/api/foods/${foodId}/sources/extract`, {
  sourceIds: [sourceId],
});
if (candidates.length === 0) {
  // 수집은 됐는데 값이 0개면 보관 원문에 성분표가 없다는 뜻이다. 조용히 넘어가면
  // "이 사료는 조사됐다"고 오해하게 되므로 실패로 끝낸다.
  console.error("근거를 갖춘 후보가 없습니다 — 보관 원문에 성분표가 없습니다.");
  process.exit(3);
}
console.log(
  `추출 ${candidates.length}건: ${candidates.map((c) => c.nutrientKey).join(", ")}`,
);

const { results } = await call(`/api/foods/${foodId}/sources/apply`, {
  evidence: candidates.map(({ excerpt, nutrientKey, sourceId, value }) => ({
    excerpt,
    nutrientKey,
    sourceId,
    value,
  })),
});
for (const result of results) {
  console.log(`  ${result.nutrientKey} = ${result.value} → ${result.status}`);
}

const applied = results.filter((r) => r.status === "applied").length;
console.log(`\nDRAFT 적용 ${applied}/${results.length}. 발행은 어드민이 한다.`);
