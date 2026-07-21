import { createAdminClient } from "@/lib/supabase/admin";
import { parseEvidenceApplyResults } from "./source-apply";
import type { EvidenceApplyResult } from "./source-apply";
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
  source: SourceWrite,
): Promise<number> {
  const supabase = createAdminClient();
  const { error: staleError } = await supabase
    .from("food_sources")
    .update({ is_current: false })
    .eq("food_id", source.foodId)
    .eq("kind", source.kind)
    .eq("is_current", true);

  if (staleError) {
    throw new SourceRepositoryError(
      "retire_current_source",
      staleError.message,
    );
  }

  const { data, error } = await supabase
    .from("food_sources")
    .insert(toSourceInsert(source, true))
    .select("id")
    .single();

  if (error)
    throw new SourceRepositoryError("create_current_source", error.message);

  const sourceLink =
    source.kind === "manufacturer"
      ? { manufacturer_url: source.url }
      : { kr_label_source: source.url };
  const { error: linkError } = await supabase
    .from("foods")
    .update(sourceLink)
    .eq("id", source.foodId);
  if (linkError)
    throw new SourceRepositoryError(
      "update_food_source_link",
      linkError.message,
    );

  return data.id;
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
