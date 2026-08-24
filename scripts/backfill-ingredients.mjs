#!/usr/bin/env node
// Task 1이 제품 식별까지 확인한 보관 캡처만 대상으로 원재료를 다시 뽑아 적용한다.
// 새 조사나 새 수집은 하지 않으며, dry-run은 추출 결과만 보여 주고 적용하지 않는다.
//
// 사용법:
//   node scripts/backfill-ingredients.mjs --dry-run FOOD_ID:SOURCE_ID,...
//   node scripts/backfill-ingredients.mjs FOOD_ID:SOURCE_ID,...

import { fileURLToPath } from "node:url";
import { SECRETS_FILE, loadSecrets } from "./with-secrets.mjs";

const PACE_MS = 8_000;
const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function positiveInteger(value, label) {
  if (!/^\d+$/.test(value)) throw new Error(`${label}는 양의 정수여야 합니다.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${label}는 양의 정수여야 합니다.`);
  return parsed;
}

export function parseBackfillArgs(args) {
  const unknownFlags = args.filter(
    (arg) => arg.startsWith("--") && arg !== "--dry-run",
  );
  const manifests = args.filter((arg) => !arg.startsWith("--"));
  if (unknownFlags.length > 0 || manifests.length !== 1) {
    throw new Error(
      "대상은 foodId:sourceId 형식으로 넘겨 주세요. 예: --dry-run 22:101,38:202",
    );
  }

  const targets = manifests[0].split(",").map((entry) => {
    const parts = entry.split(":");
    if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
      throw new Error(
        "대상은 foodId:sourceId 형식으로 넘겨 주세요. 예: 22:101,38:202",
      );
    }
    const foodId = positiveInteger(parts[0], "사료 ID");
    const sourceIds = parts[1]
      .split("+")
      .map((sourceId) => positiveInteger(sourceId, "출처 ID"));
    if (sourceIds.length > 2)
      throw new Error(
        "사료 하나에는 출처 ID를 최대 2개까지 지정할 수 있습니다.",
      );
    if (new Set(sourceIds).size !== sourceIds.length)
      throw new Error(`[${foodId}] 출처 ID가 중복되었습니다.`);
    return { foodId, sourceIds };
  });

  if (targets.length === 0)
    throw new Error("대상은 foodId:sourceId 형식으로 넘겨 주세요.");
  if (new Set(targets.map(({ foodId }) => foodId)).size !== targets.length)
    throw new Error("사료 ID가 중복되었습니다.");

  return { dryRun: args.includes("--dry-run"), targets };
}

function emptyTally() {
  return {
    applied: 0,
    conflict: 0,
    dry_run: 0,
    failed: 0,
    no_draft: 0,
    rate_limited: 0,
    refused: 0,
    skipped: 0,
  };
}

async function responsePayload(response) {
  return response.json().catch(() => null);
}

export async function runIngredientBackfill({
  adminSecret,
  baseUrl,
  dryRun,
  targets,
  fetchImpl = globalThis.fetch,
  log = console.log,
  paceMs = PACE_MS,
  wait = waitFor,
}) {
  const root = baseUrl.replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    "x-admin-secret": adminSecret,
  };
  const tally = emptyTally();

  for (const [index, target] of targets.entries()) {
    if (index > 0 && paceMs > 0) await wait(paceMs);

    const extracted = await fetchImpl(
      `${root}/api/foods/${target.foodId}/sources/extract`,
      {
        body: JSON.stringify({ sourceIds: target.sourceIds }),
        headers,
        method: "POST",
      },
    );
    if (extracted.status === 429) {
      const header = Number(extracted.headers.get("Retry-After"));
      const retryAfter = Number.isFinite(header) && header >= 0 ? header : 60;
      log(`[${target.foodId}] 한도 초과, ${retryAfter}초 대기`);
      tally.rate_limited += 1;
      await wait((retryAfter + 1) * 1_000);
      continue;
    }

    const extractedPayload = await responsePayload(extracted);
    if (!extracted.ok) {
      log(
        `[${target.foodId}] extract 실패 ${extracted.status}: ${extractedPayload?.error ?? "본문 없음"}`,
      );
      tally[extracted.status >= 500 ? "failed" : "refused"] += 1;
      continue;
    }

    const ingredientDraft = extractedPayload?.ingredientDraft;
    if (!ingredientDraft) {
      log(`[${target.foodId}] 원재료 근거 없음`);
      tally.no_draft += 1;
      continue;
    }
    if (
      !target.sourceIds.includes(ingredientDraft.sourceId) ||
      !Array.isArray(ingredientDraft.ingredients) ||
      ingredientDraft.ingredients.length === 0
    ) {
      log(`[${target.foodId}] extract 응답 형식 오류`);
      tally.refused += 1;
      continue;
    }

    if (dryRun) {
      const names = ingredientDraft.ingredients
        .map((ingredient) => ingredient.name)
        .join(", ");
      log(
        `[${target.foodId}] dry-run: ${ingredientDraft.ingredients.length}개 항목 (source ${ingredientDraft.sourceId})\n  ${names}`,
      );
      tally.dry_run += 1;
      continue;
    }

    const applied = await fetchImpl(
      `${root}/api/foods/${target.foodId}/sources/ingredients`,
      {
        body: JSON.stringify(ingredientDraft),
        headers,
        method: "POST",
      },
    );
    const appliedPayload = await responsePayload(applied);
    const applyStatus = appliedPayload?.result?.status;
    if (
      !applied.ok ||
      !["applied", "conflict", "skipped"].includes(applyStatus)
    ) {
      log(
        `[${target.foodId}] apply 거절 ${applied.status}: ${appliedPayload?.error ?? "응답 형식 오류"}`,
      );
      tally[applied.status >= 500 ? "failed" : "refused"] += 1;
      continue;
    }
    tally[applyStatus] += 1;
    log(
      `[${target.foodId}] ${applyStatus} (${appliedPayload.result.count}개 항목)`,
    );
  }

  log("\n--- 수율 ---");
  log(`대상:      ${targets.length}`);
  for (const [key, value] of Object.entries(tally)) {
    log(`${key.padEnd(12)} ${value}`);
  }
  return tally;
}

async function main() {
  loadSecrets();
  const adminSecret = process.env.ADMIN_WRITE_SECRET;
  if (!adminSecret)
    throw new Error(`ADMIN_WRITE_SECRET가 ${SECRETS_FILE}에 없습니다.`);
  const { dryRun, targets } = parseBackfillArgs(process.argv.slice(2));
  await runIngredientBackfill({
    adminSecret,
    baseUrl:
      process.env.CATFOOD_BASE_URL ??
      process.env.RESEARCH_BROKER_URL ??
      "http://localhost:3000",
    dryRun,
    targets,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
