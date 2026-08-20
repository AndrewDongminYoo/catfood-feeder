import type {
  AdvisorCatalogLoadResult,
  FoodWithBrand,
  NutrientEvidence,
  NutrientSourceKey,
} from "@/lib/catalog";
import { COOKING_METHOD_VALUES, type CookingMethod } from "@/lib/domain";
import {
  findMatchingNutrientEvidence,
  nutrientEvidenceMatchesValue,
} from "@/lib/nutrient-evidence";

export type NutrientBound = "minimum" | "maximum" | "unspecified";

export interface AdvisorQuery {
  currentFoodId: number;
  cookingMethod: CookingMethod | null;
  maxKcalDeltaPct: 5 | 10 | 15 | null;
  requireDeclaredCarb: boolean;
}

export type AdvisorQueryParseResult =
  | { ok: true; query: AdvisorQuery }
  | { ok: false; error: "invalid_current_food" };

export type AdvisorReason =
  "kcal_nearby" | "cooking_method_match" | "declared_carb_available";

export type AdvisorTradeoff = "product_recall_history" | "brand_recall_history";

export type AdvisorUnknown =
  | "kcal_unknown"
  | "protein_unknown"
  | "protein_bound_unspecified"
  | "carb_unknown"
  | "carb_bound_unspecified"
  | "carb_point_comparison_unavailable";

export interface AdvisorCandidate {
  food: FoodWithBrand;
  kcalDeltaPct: number | null;
  matchedReasons: readonly AdvisorReason[];
  tradeoffs: readonly AdvisorTradeoff[];
  unknowns: readonly AdvisorUnknown[];
  evidence: readonly NutrientEvidence[];
}

export type AdvisorSelection =
  | { kind: "current_food_not_found" }
  | {
      kind: "ready";
      candidates: readonly AdvisorCandidate[];
      excluded: {
        cookingMethod: number;
        declaredCarb: number;
        kcalMissing: number;
        kcalOutsideRange: number;
      };
    };

export function classifyNutrientBound(excerpt: string): NutrientBound {
  const normalized = excerpt.normalize("NFKC").toLowerCase().trim();
  if (!normalized) return "unspecified";

  const hasMinimum =
    /이상/.test(normalized) ||
    /\bmin(?:imum)?\b/.test(normalized) ||
    /\bat\s+least\b/.test(normalized);
  const hasMaximum =
    /이하/.test(normalized) ||
    /\bmax(?:imum)?\b/.test(normalized) ||
    /\bat\s+most\b/.test(normalized) ||
    /\bnot\s+more\s+than\b/.test(normalized);

  if (hasMinimum === hasMaximum) return "unspecified";
  return hasMinimum ? "minimum" : "maximum";
}

type AdvisorSearchParamValue = string | readonly string[] | undefined;

export interface AdvisorSearchParams {
  current?: AdvisorSearchParamValue;
  cookingMethod?: AdvisorSearchParamValue;
  kcalDelta?: AdvisorSearchParamValue;
  declaredCarb?: AdvisorSearchParamValue;
}

function firstParam(value: AdvisorSearchParamValue): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : undefined;
}

function isCookingMethod(value: string): value is CookingMethod {
  return COOKING_METHOD_VALUES.some((candidate) => candidate === value);
}

function parseKcalDelta(value: string | undefined): 5 | 10 | 15 | null {
  if (value === "5") return 5;
  if (value === "10") return 10;
  if (value === "15") return 15;
  return null;
}

export function parseAdvisorSearchParams(
  params: AdvisorSearchParams,
): AdvisorQueryParseResult {
  const current = firstParam(params.current);
  if (!current || !/^\d+$/.test(current)) {
    return { ok: false, error: "invalid_current_food" };
  }

  const currentFoodId = Number(current);
  if (!Number.isSafeInteger(currentFoodId) || currentFoodId <= 0) {
    return { ok: false, error: "invalid_current_food" };
  }

  const cookingMethodParam = firstParam(params.cookingMethod);

  return {
    ok: true,
    query: {
      currentFoodId,
      cookingMethod:
        cookingMethodParam && isCookingMethod(cookingMethodParam)
          ? cookingMethodParam
          : null,
      maxKcalDeltaPct: parseKcalDelta(firstParam(params.kcalDelta)),
      requireDeclaredCarb: firstParam(params.declaredCarb) === "1",
    },
  };
}

type AvailableAdvisorCatalog = Extract<
  AdvisorCatalogLoadResult,
  { available: true }
>;

function kcalDeltaPct(
  currentKcal: number | null,
  candidateKcal: number | null,
): number | null {
  if (
    currentKcal === null ||
    currentKcal <= 0 ||
    candidateKcal === null ||
    candidateKcal <= 0
  ) {
    return null;
  }
  return (Math.abs(candidateKcal - currentKcal) / currentKcal) * 100;
}

function isDeclaredCarbohydrate(
  food: FoodWithBrand,
  evidence: readonly NutrientEvidence[],
): boolean {
  const source = food.nutrient_sources.carb_pct;
  return (
    food.carb_pct !== null &&
    (source === "manufacturer" || source === "kr_label") &&
    findMatchingNutrientEvidence(evidence, "carb_pct", food.carb_pct) !== null
  );
}

function nutrientBound(
  evidence: readonly NutrientEvidence[],
  nutrientKey: NutrientSourceKey,
  value: number | null,
): NutrientBound {
  const excerpts = evidence
    .filter(
      (row) =>
        row.nutrient_key === nutrientKey &&
        nutrientEvidenceMatchesValue(row, value),
    )
    .map((row) => row.excerpt)
    .join("\n");
  return classifyNutrientBound(excerpts);
}

function candidateTradeoffs(food: FoodWithBrand): AdvisorTradeoff[] {
  const tradeoffs: AdvisorTradeoff[] = [];
  if (food.recalls?.some((recall) => recall.scope === "product")) {
    tradeoffs.push("product_recall_history");
  }
  if (food.recalls?.some((recall) => recall.scope === "brand")) {
    tradeoffs.push("brand_recall_history");
  }
  return tradeoffs;
}

function candidateUnknowns(
  food: FoodWithBrand,
  evidence: readonly NutrientEvidence[],
  deltaPct: number | null,
): AdvisorUnknown[] {
  const unknowns: AdvisorUnknown[] = [];
  if (deltaPct === null) unknowns.push("kcal_unknown");

  const proteinEvidence = findMatchingNutrientEvidence(
    evidence,
    "protein_pct",
    food.protein_pct,
  );
  if (
    food.protein_pct === null ||
    !food.nutrient_sources.protein_pct ||
    proteinEvidence === null
  ) {
    unknowns.push("protein_unknown");
  } else if (
    (food.nutrient_sources.protein_pct === "manufacturer" ||
      food.nutrient_sources.protein_pct === "kr_label") &&
    nutrientBound(evidence, "protein_pct", food.protein_pct) === "unspecified"
  ) {
    unknowns.push("protein_bound_unspecified");
  }

  const carbSource = food.nutrient_sources.carb_pct;
  if (food.carb_pct === null || !carbSource) {
    unknowns.push("carb_unknown");
  } else if (carbSource === "derived" || carbSource === "estimated") {
    unknowns.push("carb_point_comparison_unavailable");
  } else if (
    findMatchingNutrientEvidence(evidence, "carb_pct", food.carb_pct) === null
  ) {
    unknowns.push("carb_unknown");
  } else if (
    nutrientBound(evidence, "carb_pct", food.carb_pct) === "unspecified"
  ) {
    unknowns.push("carb_bound_unspecified");
  }

  return unknowns;
}

export function findAdvisorCandidates(
  catalog: AvailableAdvisorCatalog,
  query: AdvisorQuery,
): AdvisorSelection {
  const currentFood = catalog.foods.find(
    (food) => food.id === query.currentFoodId,
  );
  if (!currentFood) return { kind: "current_food_not_found" };
  const currentEvidence = catalog.evidenceByFoodId.get(currentFood.id) ?? [];
  const currentKcal =
    findMatchingNutrientEvidence(
      currentEvidence,
      "kcal_per_kg",
      currentFood.kcal_per_kg,
    ) === null
      ? null
      : currentFood.kcal_per_kg;

  const excluded = {
    cookingMethod: 0,
    declaredCarb: 0,
    kcalMissing: 0,
    kcalOutsideRange: 0,
  };
  const candidates: AdvisorCandidate[] = [];

  for (const food of catalog.foods) {
    if (food.id === currentFood.id) continue;
    const evidence = catalog.evidenceByFoodId.get(food.id) ?? [];

    if (
      query.cookingMethod !== null &&
      food.cooking_method !== query.cookingMethod
    ) {
      excluded.cookingMethod += 1;
      continue;
    }

    const candidateKcal =
      findMatchingNutrientEvidence(
        evidence,
        "kcal_per_kg",
        food.kcal_per_kg,
      ) === null
        ? null
        : food.kcal_per_kg;
    const deltaPct = kcalDeltaPct(currentKcal, candidateKcal);
    if (query.maxKcalDeltaPct !== null) {
      if (deltaPct === null) {
        excluded.kcalMissing += 1;
        continue;
      }
      if (deltaPct > query.maxKcalDeltaPct) {
        excluded.kcalOutsideRange += 1;
        continue;
      }
    }

    if (query.requireDeclaredCarb && !isDeclaredCarbohydrate(food, evidence)) {
      excluded.declaredCarb += 1;
      continue;
    }

    const matchedReasons: AdvisorReason[] = [];
    if (deltaPct !== null) matchedReasons.push("kcal_nearby");
    if (query.cookingMethod !== null) {
      matchedReasons.push("cooking_method_match");
    }
    if (query.requireDeclaredCarb) {
      matchedReasons.push("declared_carb_available");
    }

    candidates.push({
      evidence,
      food,
      kcalDeltaPct: deltaPct,
      matchedReasons,
      tradeoffs: candidateTradeoffs(food),
      unknowns: candidateUnknowns(food, evidence, deltaPct),
    });
  }

  candidates.sort((left, right) => {
    if (left.kcalDeltaPct === null && right.kcalDeltaPct === null) {
      return left.food.id - right.food.id;
    }
    if (left.kcalDeltaPct === null) return 1;
    if (right.kcalDeltaPct === null) return -1;
    return (
      left.kcalDeltaPct - right.kcalDeltaPct || left.food.id - right.food.id
    );
  });

  return { candidates: candidates.slice(0, 3), excluded, kind: "ready" };
}
