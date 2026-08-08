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

import { fileURLToPath } from "node:url";
import { SECRETS_FILE, loadSecrets } from "./with-secrets.mjs";

export const BASE_URL =
  process.env.RESEARCH_BROKER_URL ?? "http://localhost:3000";

export function adminSecret() {
  const secret = process.env.ADMIN_WRITE_SECRET;
  if (!secret)
    throw new Error(`ADMIN_WRITE_SECRET가 ${SECRETS_FILE}에 없습니다.`);
  return secret;
}

async function call(path, body, secret) {
  const response = await fetch(`${BASE_URL}${path}`, {
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

/**
 * 한 사료에 출처 하나를 붙여 DRAFT까지 끌고 간다.
 *
 * 근거 0건은 성공이 아니라 실패로 돌려준다. 수집은 성공했는데 보관 원문에 성분표가
 * 없는 경우가 흔하고(탭 패널·이미지 라벨), 이걸 성공으로 세면 "이 사료는 조사됐다"는
 * 잘못된 결론이 카탈로그 전체에 조용히 퍼진다.
 */
export async function curateSource({
  foodId,
  url,
  kind = "manufacturer",
  secret,
}) {
  const registered = await call(
    `/api/foods/${foodId}/sources`,
    { captureMethod: "fetch", kind, url },
    secret,
  );
  const sourceId = registered.source?.id;
  if (!sourceId) throw new Error("출처 등록 응답에 source.id가 없습니다");

  const { candidates = [] } = await call(
    `/api/foods/${foodId}/sources/extract`,
    { sourceIds: [sourceId] },
    secret,
  );
  if (candidates.length === 0) {
    return {
      applied: 0,
      candidates: 0,
      reason: "no_evidence_in_capture",
      sourceId,
    };
  }

  const { results } = await call(
    `/api/foods/${foodId}/sources/apply`,
    {
      evidence: candidates.map(({ excerpt, nutrientKey, sourceId, value }) => ({
        excerpt,
        nutrientKey,
        sourceId,
        value,
      })),
    },
    secret,
  );
  return {
    applied: results.filter((r) => r.status === "applied").length,
    candidates: candidates.length,
    results,
    sourceId,
  };
}

async function main() {
  loadSecrets();
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? null : process.argv[i + 1];
  };
  const foodId = Number(arg("food"));
  const url = arg("url");
  if (!Number.isInteger(foodId) || foodId <= 0 || !url) {
    console.error(
      "usage: node scripts/curate-source.mjs --food <id> --url <url>",
    );
    process.exit(1);
  }

  const outcome = await curateSource({
    foodId,
    kind: arg("kind") ?? "manufacturer",
    secret: adminSecret(),
    url,
  });
  if (outcome.reason === "no_evidence_in_capture") {
    console.error(
      "근거를 갖춘 후보가 없습니다 — 보관 원문에 성분표가 없습니다.",
    );
    process.exit(3);
  }
  for (const result of outcome.results) {
    console.log(`  ${result.nutrientKey} = ${result.value} → ${result.status}`);
  }
  console.log(
    `\nDRAFT 적용 ${outcome.applied}/${outcome.candidates}. 발행은 어드민이 한다.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
