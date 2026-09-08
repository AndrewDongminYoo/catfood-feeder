import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { selectAll } from "../../scripts/select-all.mjs";
import type { ResearchProposal } from "./research-proposal";

/** 원장에 남은 제안에서 URL만 긁어낸다. 거절된 제안도 대상이므로 느슨하게 읽는다. */
const proposedUrlsSchema = z
  .object({ sources: z.array(z.object({ url: z.string() }).loose()) })
  .loose()
  .transform((proposal) => proposal.sources.map((source) => source.url));

const transientCaptureCodes = new Set(["network_error"]);

type ResearchHistoryRow = {
  readonly captures: unknown;
  readonly id: number;
  readonly proposal: unknown;
  readonly status: string;
};

export type ResearchRetryContext = {
  readonly reason:
    "broker_error" | "claim_conflict" | "transient_capture_failure";
  readonly runId: number;
};

export type ResearchTarget =
  | {
      readonly kind: "skeleton";
      readonly id: number;
      readonly productName: string;
      readonly brandName: string | null;
    }
  | { readonly kind: "not_found" }
  | { readonly kind: "not_skeleton" };

export type ResearchRunStatus =
  | "applied"
  | "rejected"
  | "capture_failed"
  | "claim_conflict"
  | "errored"
  | "invalid"
  /** 전사 제안이 운영자의 확인을 기다린다. 값도 출처도 아직 쓰이지 않았다. */
  | "pending_review";

export class ResearchRepositoryError extends Error {
  readonly name = "ResearchRepositoryError";
}

/**
 * 이번 슬라이스의 대상은 "아직 아무 출처도 붙지 않은 skeleton DRAFT" 하나다.
 *
 * `published_at IS NULL`만으로는 부족하다. 이미 큐레이터가 출처를 붙여 둔 DRAFT를
 * 대상으로 삼으면 에이전트가 제안한 URL이 그 출처를 current에서 밀어내고, 영양값을
 * 한 글자도 건드리지 않은 채로 발행 가능 상태만 깨뜨린다.
 *
 * ponytail: 그래서 자동 조사는 사료당 사실상 1회다. manufacturer만 수집되고
 * kr_label이 실패해도 그 사료는 더 이상 skeleton이 아니라 재조사 대상에서 빠진다.
 * 남은 절반은 큐레이터가 손으로 등록하면 된다. 반쪽 재조사가 필요해지면 원장의
 * 실패 기록을 읽어 "빠진 kind만" 허용하는 쪽으로 술어를 넓히면 된다.
 */
export async function getResearchTarget(
  foodId: number,
): Promise<ResearchTarget> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("foods")
    .select(
      "id, product_name, published_at, brands:brand_id(name), food_sources(id)",
    )
    .eq("id", foodId)
    .eq("food_sources.is_current", true)
    .maybeSingle();

  if (error) throw new ResearchRepositoryError(error.message);
  if (data === null) return { kind: "not_found" };
  if (data.published_at !== null || data.food_sources.length > 0)
    return { kind: "not_skeleton" };

  return {
    brandName: data.brands?.name ?? null,
    id: data.id,
    kind: "skeleton",
    productName: data.product_name,
  };
}

/**
 * 이전 실행이 이미 시도한 URL. 러너 프롬프트에 넣어 같은 막다른 길을 다시 조사하지
 * 않게 한다. 수집 실패뿐 아니라 근거 검증에서 거절된 URL도 포함해야 의미가 있으므로
 * `food_sources`가 아니라 원장을 읽는다.
 */
export async function getAttemptedResearchUrls(
  foodId: number,
): Promise<readonly string[]> {
  const history = await loadResearchHistory(foodId);
  // 거절된 제안도 원장에 남으므로, 엄격 스키마로 읽으면 정작 기억해야 할 URL을
  // 놓친다. URL 문자열만 느슨하게 긁어낸다. 같은 URL을 다시 시도했다면 가장
  // 최근 결과만 사용해서 오래된 영구 실패가 새 일시 실패를 덮지 않게 한다.
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const run of history) {
    const proposed = proposedUrlsSchema.safeParse(run.proposal).data ?? [];
    const retryable = retryableUrls(run);
    for (const url of proposed) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (!retryable.has(url)) urls.push(url);
    }
  }
  return urls;
}

export async function getResearchRetryContext(
  foodId: number,
): Promise<ResearchRetryContext | null> {
  const history = await loadResearchHistory(foodId);
  const seen = new Set<string>();
  for (const run of history) {
    const proposed = proposedUrlsSchema.safeParse(run.proposal).data ?? [];
    const latestUrls = proposed.filter((url) => !seen.has(url));
    proposed.forEach((url) => seen.add(url));
    if (latestUrls.length === 0) continue;

    if (run.status === "claim_conflict") {
      return { reason: "claim_conflict", runId: run.id };
    }
    if (run.status === "errored") {
      return { reason: "broker_error", runId: run.id };
    }
    const retryable = retryableUrls(run);
    if (latestUrls.some((url) => retryable.has(url))) {
      return { reason: "transient_capture_failure", runId: run.id };
    }
  }
  return null;
}

async function loadResearchHistory(
  foodId: number,
): Promise<readonly ResearchHistoryRow[]> {
  const supabase = createAdminClient();
  return (await selectAll(async (from, to) =>
    supabase
      .from("food_research_runs")
      .select("id, proposal, captures, status")
      .eq("food_id", foodId)
      .order("id", { ascending: false })
      .range(from, to),
  )) as ResearchHistoryRow[];
}

function retryableUrls(run: ResearchHistoryRow): ReadonlySet<string> {
  const proposed = proposedUrlsSchema.safeParse(run.proposal).data ?? [];
  if (run.status === "claim_conflict" || run.status === "errored") {
    return new Set(proposed);
  }
  if (!Array.isArray(run.captures)) {
    return new Set();
  }
  return new Set(
    run.captures.flatMap((capture) => {
      if (
        typeof capture === "object" &&
        capture !== null &&
        "status" in capture &&
        capture.status === "failed" &&
        "failureCode" in capture &&
        typeof capture.failureCode === "string" &&
        transientCaptureCodes.has(capture.failureCode) &&
        "url" in capture &&
        typeof capture.url === "string"
      ) {
        return [capture.url];
      }
      return [];
    }),
  );
}

export type ResearchAgentMetadata = ResearchProposal["agent"];

export async function recordFoodResearchRun(run: {
  readonly foodId: number;
  readonly agent: ResearchAgentMetadata;
  /** 검증을 통과하지 못한 제안도 그대로 보존한다 — 그것이 기억의 단위다. */
  readonly proposal: unknown;
  readonly captures: unknown;
  readonly evidenceResults: unknown;
  readonly terminalReason?: string;
  readonly status: ResearchRunStatus;
}): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("food_research_runs")
    .insert({
      agent_model: run.agent.model,
      agent_name: run.agent.name,
      captures: run.captures as never,
      evidence_results: (run.terminalReason
        ? { outcomes: run.evidenceResults, terminalReason: run.terminalReason }
        : run.evidenceResults) as never,
      food_id: run.foodId,
      prompt_version: run.agent.promptVersion,
      proposal: run.proposal as never,
      schema_version: run.agent.schemaVersion,
      status: run.status,
    })
    .select("id")
    .single();

  if (error) throw new ResearchRepositoryError(error.message);
  return data.id;
}
