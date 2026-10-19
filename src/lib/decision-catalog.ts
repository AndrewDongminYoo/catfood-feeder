import { getAdequacyProofs } from "./adequacy-repository";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { getAdvisorCatalog, isSupabaseConfigured } from "./catalog";
import { createAdminClient } from "./supabase/admin";
import {
  ingredientEvidenceSchema,
  type IngredientProof,
} from "./food-decision";

/** 공개된 제품에 속하는 현재 원재료 근거만 반환한다. 비공개 원문과 초안은 포함하지 않는다. */
export async function loadDecisionIngredientProofs(
  client: SupabaseClient<Database>,
  publishedIds: readonly number[],
): Promise<Record<number, IngredientProof>> {
  const allowed = new Set(publishedIds);
  const result: Record<number, IngredientProof> = {};
  for (let offset = 0; offset < publishedIds.length; offset += 100) {
    const { data, error } = await client
      .from("food_ingredient_evidence")
      .select(
        "food_id,excerpt,captured_at,foods!inner(published_at),food_sources!inner(food_id,url,is_current)",
      )
      .not("foods.published_at", "is", null)
      .eq("is_current", true)
      .in("food_id", publishedIds.slice(offset, offset + 100));
    if (error) throw error;
    for (const row of data ?? []) {
      const source = row.food_sources;
      if (
        !allowed.has(row.food_id) ||
        !row.foods?.published_at ||
        source.food_id !== row.food_id ||
        !source.is_current
      )
        continue;
      const parsed = ingredientEvidenceSchema.safeParse({
        excerpt: row.excerpt,
        capturedAt: row.captured_at,
        url: source.url,
      });
      if (parsed.success) result[row.food_id] = parsed.data;
    }
  }
  return result;
}

export async function getDecisionCatalog(options: { fresh?: boolean } = {}) {
  const catalog = await getAdvisorCatalog(options);
  if (!catalog.available)
    return {
      available: false as const,
      foods: [],
      evidence: [],
      ingredientEvidenceByFoodId: {},
      adequacyByFoodId: {},
      sample: false,
    };
  let adequacyByFoodId = {};
  let ingredientEvidenceByFoodId: Record<number, IngredientProof> = {};
  if (isSupabaseConfigured() && catalog.foods.length) {
    try {
      ingredientEvidenceByFoodId = await loadDecisionIngredientProofs(
        createAdminClient(),
        catalog.foods.map((f) => f.id),
      );
    } catch (error) {
      console.error(
        "Failed to load public decision ingredient evidence",
        error instanceof Error ? error.message : "query failed",
      );
    }
  }
  try {
    adequacyByFoodId = await getAdequacyProofs(catalog.foods.map((f) => f.id));
  } catch {
    console.error("Failed to load public adequacy evidence");
    return {
      available: false as const,
      foods: [],
      evidence: [],
      ingredientEvidenceByFoodId: {},
      adequacyByFoodId: {},
      sample: false,
    };
  }
  return {
    adequacyByFoodId,
    available: true as const,
    foods: catalog.foods,
    evidence: [...catalog.evidenceByFoodId.entries()],
    ingredientEvidenceByFoodId,
    sample: !isSupabaseConfigured(),
  };
}
