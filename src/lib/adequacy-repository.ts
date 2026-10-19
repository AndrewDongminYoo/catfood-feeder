import { createAdminClient } from "./supabase/admin";
import { createPublicClient } from "./supabase/public";
import { isSupabaseConfigured } from "./catalog";
import { selectAll } from "../../scripts/select-all.mjs";
import {
  type AdequacyApply,
  type AdequacyProof,
  projectAdequacy,
  validateAdequacyCapture,
} from "./adequacy-evidence";

export class AdequacyRefusal extends Error {}
export async function applyAdequacy(
  foodId: number,
  draft: AdequacyApply,
  origin: "human" | "automation",
) {
  const client = createAdminClient();
  const { data: source, error } = await client
    .from("food_sources")
    .select(
      "food_id,kind,is_current,fetch_status,content_hash,captured_at,captured_text",
    )
    .eq("id", draft.sourceId)
    .maybeSingle();
  if (error) throw error;
  if (!source || !validateAdequacyCapture(foodId, draft, source))
    throw new AdequacyRefusal(
      "Declaration does not match the current single-product capture",
    );
  const result = await client.rpc("apply_food_adequacy_declaration", {
    p_food_id: foodId,
    p_source_id: draft.sourceId,
    p_statement: draft.statement,
    p_source_product_name: draft.sourceProductName,
    p_expected_content_hash: draft.sourceContentHash,
    p_applied_by_origin: origin,
  });
  if (result.error?.code === "CFADQ")
    throw new AdequacyRefusal("Declaration rejected");
  if (result.error) throw result.error;
  return result.data;
}

/** The anonymous reader exercises RLS, even when called by a privileged server. */
export async function getAdequacyProofs(
  foodIds: readonly number[],
): Promise<Record<number, AdequacyProof[]>> {
  if (!isSupabaseConfigured() || !foodIds.length) return {};
  const client = createPublicClient();
  const result: Record<number, AdequacyProof[]> = {};
  const allowed = new Set(foodIds);
  for (let offset = 0; offset < foodIds.length; offset += 100) {
    const rows = await selectAll(
      async (from, to) =>
        await client
          .from("food_adequacy_declarations")
          .select(
            "id,food_id,statement,source_product_name,captured_at,applied_by_origin,food_sources!inner(url)",
          )
          .in("food_id", foodIds.slice(offset, offset + 100))
          .order("id")
          .range(from, to),
    );
    for (const row of rows as (Parameters<typeof projectAdequacy>[0] & {
      food_id: number;
    })[]) {
      if (!allowed.has(row.food_id)) continue;
      const proof = projectAdequacy(row);
      if (proof) (result[row.food_id] ??= []).push(proof);
    }
  }
  return result;
}
