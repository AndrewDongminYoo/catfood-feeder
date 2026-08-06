import { createAdminClient } from "@/lib/supabase/admin";
import { researchProposalSchema } from "./research-proposal";
import type { ResearchProposal } from "./research-proposal";

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
  "applied" | "rejected" | "capture_failed" | "claim_conflict" | "errored";

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
  limit = 20,
): Promise<readonly string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("food_research_runs")
    .select("proposal")
    .eq("food_id", foodId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new ResearchRepositoryError(error.message);
  const urls = (data ?? []).flatMap((run) => {
    const parsed = researchProposalSchema.safeParse(run.proposal);
    return parsed.success ? parsed.data.sources.map((s) => s.url) : [];
  });
  return [...new Set(urls)];
}

export async function recordFoodResearchRun(run: {
  readonly foodId: number;
  readonly proposal: ResearchProposal;
  readonly captures: unknown;
  readonly evidenceResults: unknown;
  readonly status: ResearchRunStatus;
}): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("food_research_runs")
    .insert({
      agent_model: run.proposal.agent.model,
      agent_name: run.proposal.agent.name,
      captures: run.captures as never,
      evidence_results: run.evidenceResults as never,
      food_id: run.foodId,
      prompt_version: run.proposal.agent.promptVersion,
      proposal: run.proposal as never,
      schema_version: run.proposal.agent.schemaVersion,
      status: run.status,
    })
    .select("id")
    .single();

  if (error) throw new ResearchRepositoryError(error.message);
  return data.id;
}
