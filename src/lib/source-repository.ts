import { createAdminClient } from "@/lib/supabase/admin";
import { parseEvidenceApplyResults } from "./source-apply";
import type { EvidenceApplyResult } from "./source-apply";
import {
  parseResearchSourceReplacement,
  parseSourceReplacementResult,
} from "./source-capture-response";
import type {
  ResearchSourceReplacementResult,
  SourceReplacementResult,
} from "./source-capture-response";
import type { ExtractedEvidence } from "./source-extraction";
import type {
  SourceCaptureMethod,
  SourceFetchStatus,
  SourceKind,
} from "./source-collection";

type SourceWrite = {
  readonly capturedAt: string | null;
  readonly capturedText: string | null;
  readonly captureMethod: SourceCaptureMethod;
  readonly contentHash: string | null;
  readonly createdBy: string | null;
  readonly failureCode: string | null;
  readonly fetchStatus: SourceFetchStatus;
  readonly foodId: number;
  readonly kind: SourceKind;
  readonly observedAt: string | null;
  readonly url: string;
};

export class SourceRepositoryError extends Error {
  readonly name = "SourceRepositoryError";

  constructor(
    readonly operation: string,
    message: string,
  ) {
    super(message);
  }
}

export async function foodExists(foodId: number): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("foods")
    .select("id")
    .eq("id", foodId)
    .maybeSingle();

  if (error) throw new SourceRepositoryError("food_exists", error.message);
  return data !== null;
}

export async function createFailedFoodSource(
  source: SourceWrite,
): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("food_sources")
    .insert(toSourceInsert(source, false))
    .select("id")
    .single();

  if (error)
    throw new SourceRepositoryError("create_failed_source", error.message);
  return data.id;
}

export async function replaceCurrentFoodSource(
  source: SourceWrite & {
    readonly capturedAt: string;
    readonly capturedText: string;
    readonly contentHash: string;
  },
): Promise<SourceReplacementResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("replace_current_food_source", {
    p_capture_method: source.captureMethod,
    p_captured_at: source.capturedAt,
    p_captured_text: source.capturedText,
    p_content_hash: source.contentHash,
    p_food_id: source.foodId,
    p_kind: source.kind,
    p_url: source.url,
    ...(source.createdBy === null ? {} : { p_created_by: source.createdBy }),
    ...(source.observedAt === null ? {} : { p_observed_at: source.observedAt }),
  });

  if (error)
    throw new SourceRepositoryError("replace_current_source", error.message);
  try {
    return parseSourceReplacementResult(data);
  } catch {
    throw new SourceRepositoryError(
      "replace_current_source",
      "Source replacement RPC returned an invalid result",
    );
  }
}

/**
 * 조사 경로 전용 교체. skeleton 조건을 교체 트랜잭션 안에서 다시 확인하므로,
 * 수집에 걸린 시간 동안 큐레이터가 출처를 등록했거나 다른 실행이 먼저 통과했다면
 * 아무것도 쓰지 않고 conflict를 돌려준다.
 */
export async function replaceUnclaimedFoodSource(
  source: SourceWrite & {
    readonly capturedAt: string;
    readonly capturedText: string;
    readonly contentHash: string;
    /** 이번 실행이 이미 만든 출처. 그 밖의 current 출처가 있으면 RPC가 거절한다. */
    readonly ownedSourceIds: readonly number[];
  },
): Promise<ResearchSourceReplacementResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("replace_current_food_source", {
    p_capture_method: source.captureMethod,
    p_captured_at: source.capturedAt,
    p_captured_text: source.capturedText,
    p_content_hash: source.contentHash,
    p_food_id: source.foodId,
    p_kind: source.kind,
    p_owned_source_ids: [...source.ownedSourceIds],
    p_url: source.url,
  });

  if (error)
    throw new SourceRepositoryError("replace_unclaimed_source", error.message);
  try {
    return parseResearchSourceReplacement(data);
  } catch {
    throw new SourceRepositoryError(
      "replace_unclaimed_source",
      "Source replacement RPC returned an invalid result",
    );
  }
}

export async function getCurrentFetchedFoodSources(
  foodId: number,
  sourceIds: readonly number[],
) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("food_sources")
    .select("id, kind, captured_text")
    .eq("food_id", foodId)
    .eq("is_current", true)
    .eq("fetch_status", "fetched")
    .in("id", sourceIds);

  if (error)
    throw new SourceRepositoryError("get_current_sources", error.message);
  return (data ?? []).flatMap((source) =>
    source.captured_text &&
    (source.kind === "manufacturer" || source.kind === "kr_label")
      ? [
          {
            capturedText: source.captured_text,
            id: source.id,
            kind: source.kind,
          },
        ]
      : [],
  );
}

type SourceTranscriptRow = {
  readonly id: number;
  readonly kind: "manufacturer" | "kr_label";
  readonly url: string;
  readonly captured_at: string | null;
  readonly captured_text: string | null;
};

// 프리뷰는 선택된 사료 하나의 current+fetched 출처만 필요하다. captured_text는
// 최대 256 KiB라 Draft 목록 쿼리에서 제외하고, 선택 시점에 이 함수로 지연 로드한다.
export async function getFoodSourceTranscripts(
  foodId: number,
): Promise<readonly SourceTranscriptRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("food_sources")
    .select("id, kind, url, captured_at, captured_text")
    .eq("food_id", foodId)
    .eq("is_current", true)
    .eq("fetch_status", "fetched")
    .order("id");

  if (error)
    throw new SourceRepositoryError("get_source_transcripts", error.message);
  return (data ?? []).flatMap((source) =>
    source.kind === "manufacturer" || source.kind === "kr_label"
      ? [{ ...source, kind: source.kind }]
      : [],
  );
}

/** RPC가 "이 실행은 대상을 잃었다"를 알리는 커스텀 SQLSTATE. */
const CLAIM_LOST_SQLSTATE = "CFCLM";

export type ResearchEvidenceApplyOutcome =
  | {
      readonly claim: "claimed";
      readonly results: readonly EvidenceApplyResult[];
    }
  | { readonly claim: "conflict" };

/**
 * 조사 경로 전용 근거 적용. 수집 시점에 잡은 소유권을 적용 트랜잭션 안에서 다시
 * 확인하므로, 그 사이 큐레이터가 다른 kind의 출처를 붙였다면 아무 값도 쓰지 않는다.
 */
export async function applyUnclaimedFoodEvidenceDraft(
  foodId: number,
  evidence: readonly ExtractedEvidence[],
  ownedSourceIds: readonly number[],
): Promise<ResearchEvidenceApplyOutcome> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("apply_food_evidence_draft", {
    p_evidence: evidence.map((candidate) => ({
      excerpt: candidate.excerpt,
      nutrient_key: candidate.nutrientKey,
      source_id: candidate.sourceId,
      value: candidate.value,
    })),
    p_food_id: foodId,
    p_owned_source_ids: [...ownedSourceIds],
  });

  if (error) {
    if (error.code === CLAIM_LOST_SQLSTATE) return { claim: "conflict" };
    throw new SourceRepositoryError("apply_food_evidence", error.message);
  }
  const results = parseEvidenceApplyResults(data);
  if (results.length !== evidence.length)
    throw new SourceRepositoryError(
      "apply_food_evidence",
      "Evidence RPC returned an incomplete result",
    );
  return { claim: "claimed", results };
}

export async function applyFoodEvidenceDraft(
  foodId: number,
  evidence: readonly ExtractedEvidence[],
): Promise<readonly EvidenceApplyResult[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("apply_food_evidence_draft", {
    p_evidence: evidence.map((candidate) => ({
      excerpt: candidate.excerpt,
      nutrient_key: candidate.nutrientKey,
      source_id: candidate.sourceId,
      value: candidate.value,
    })),
    p_food_id: foodId,
  });
  if (error)
    throw new SourceRepositoryError("apply_food_evidence", error.message);
  const results = parseEvidenceApplyResults(data);
  if (results.length !== evidence.length)
    throw new SourceRepositoryError(
      "apply_food_evidence",
      "Evidence RPC returned an incomplete result",
    );
  return results;
}

function toSourceInsert(source: SourceWrite, isCurrent: boolean) {
  return {
    captured_at: source.capturedAt,
    captured_text: source.capturedText,
    capture_method: source.captureMethod,
    content_hash: source.contentHash,
    created_by: source.createdBy,
    failure_code: source.failureCode,
    fetch_status: source.fetchStatus,
    food_id: source.foodId,
    is_current: isCurrent,
    kind: source.kind,
    observed_at: source.observedAt,
    url: source.url,
  };
}
