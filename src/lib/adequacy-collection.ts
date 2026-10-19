import {
  extractAdequacyDeclarations,
  type AdequacyDeclarationDraft,
} from "./food-adequacy.ts";

export type AdequacyCollectionSource = {
  id: number;
  food_id: number;
  kind: string;
  fetch_status: string;
  is_current: boolean;
  url: string;
  captured_at: string | null;
  content_hash: string | null;
  captured_text: string | null;
  foods: { id: number; product_name: string; published_at: string | null };
};
export function buildAdequacyCollection(
  sources: readonly AdequacyCollectionSource[],
  generatedAt: string,
) {
  const eligible = sources.filter(
    (source) =>
      source.kind === "manufacturer" &&
      source.is_current &&
      source.fetch_status === "fetched" &&
      source.foods?.published_at &&
      source.food_id === source.foods.id &&
      /^https:\/\//.test(source.url),
  );
  const declarations: (AdequacyDeclarationDraft & {
    foodId: number;
    productName: string;
    sourceId: number;
    url: string;
    capturedAt: string;
    sourceContentHash: string | null;
    salesMarket: null;
    reviewRequired: {
      productIdentity: true;
      salesMarket: true;
      currentPackage: true;
    };
  })[] = [];
  const unresolved: {
    foodId: number;
    sourceId: number;
    url: string;
    reason: string;
  }[] = [];
  const identityReview: {
    linkedFoodId: number;
    sourceId: number;
    url: string;
    candidates: AdequacyDeclarationDraft[];
  }[] = [];
  for (const source of eligible) {
    const found =
      source.captured_text && source.captured_at
        ? extractAdequacyDeclarations(source.captured_text)
        : [];
    const catCandidates = found.filter((item) => item.species !== "dog");
    if (found.length > 1) {
      identityReview.push({
        linkedFoodId: source.food_id,
        sourceId: source.id,
        url: source.url,
        candidates: found,
      });
      unresolved.push({
        foodId: source.food_id,
        sourceId: source.id,
        url: source.url,
        reason: "multiple_distinct_declarations",
      });
      continue;
    }
    if (!catCandidates.length || !source.captured_at) {
      unresolved.push({
        foodId: source.food_id,
        sourceId: source.id,
        url: source.url,
        reason: found.length ? "species_mismatch" : "no_recognized_declaration",
      });
      continue;
    }
    for (const declaration of catCandidates) {
      declarations.push({
        ...declaration,
        foodId: source.food_id,
        productName: source.foods.product_name,
        sourceId: source.id,
        url: source.url,
        capturedAt: source.captured_at,
        sourceContentHash: source.content_hash,
        salesMarket: null,
        reviewRequired: {
          productIdentity: true,
          salesMarket: true,
          currentPackage: true,
        },
      });
    }
  }
  return {
    version: 1 as const,
    generatedAt,
    scope:
      "retained_current_manufacturer_captures_for_published_cat_foods" as const,
    sourceCount: eligible.length,
    foodCount: new Set(eligible.map((source) => source.food_id)).size,
    declarationSourceCount: new Set(declarations.map((item) => item.sourceId))
      .size,
    declarationFoodCount: new Set(declarations.map((item) => item.foodId)).size,
    declarations,
    unresolved,
    identityReview,
  };
}
