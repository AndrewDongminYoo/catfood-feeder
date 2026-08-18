import { unstable_cache } from "next/cache";
import { SAMPLE_FOODS } from "@/lib/fixtures";
import { createPublicClient } from "@/lib/supabase/public";
import type { CookingMethod, NutrientKey, Source } from "@/lib/domain";
import type { Database } from "@/types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BrandSummary {
  id: number;
  name: string;
  manufacturer: string | null;
  importer: string | null;
  country: string | null;
}

export interface Ingredient {
  name: string;
  pct: number | null;
  type: "meat" | "fish" | "plant" | "other";
}

export interface RecallSummary {
  id: number;
  brand_id: number | null;
  food_id: number | null;
  source: string;
  source_url: string;
  external_id: string | null;
  recalling_firm: string | null;
  reason: string | null;
  classification: string | null;
  affected_lots: string | null;
  recall_date: string | null;
  region: string | null;
  scope: RecallScope;
}

export type RecallScope = "product" | "brand" | "unlinked";
export type RecallRecord = Omit<RecallSummary, "scope">;

export function classifyRecallScope(
  recall: Pick<RecallRecord, "brand_id" | "food_id">,
): RecallScope {
  if (recall.food_id !== null) return "product";
  if (recall.brand_id !== null) return "brand";
  return "unlinked";
}

/** `foods.nutrient_sources`에 출처 태그가 붙는 필드. 보장성분 + 파생 열량비. */
export type NutrientSourceKey =
  NutrientKey | "carb_pct" | "energy_p_pct" | "energy_f_pct" | "energy_c_pct";

/** Phase 5(가격/알림) 전까지 채워지지 않는다. 스키마는 BLUEPRINT에 따라 유지. */
export interface PriceSummary {
  id: number;
  retailer: string;
  price: number;
  price_per_100g: number | null;
  url: string | null;
  captured_at: string;
}

export interface FoodWithBrand {
  id: number;
  brand_id: number;
  product_name: string;
  cooking_method: CookingMethod | null;
  protein_pct: number | null;
  fat_pct: number | null;
  fiber_pct: number | null;
  ash_pct: number | null;
  moisture_pct: number | null;
  calcium_pct: number | null;
  phosphorus_pct: number | null;
  kcal_per_kg: number | null;
  carb_pct: number | null;
  carb_is_estimated: boolean;
  energy_p_pct: number | null;
  energy_f_pct: number | null;
  energy_c_pct: number | null;
  ca_p_ratio: number | null;
  // string 키였을 때는 오타나 이름 변경이 타입체크를 통과한 뒤 조용히 "미기록"으로
  // 렌더링됐다. 실제로 기록되는 키만 허용한다.
  nutrient_sources: Partial<Record<NutrientSourceKey, Source>>;
  ingredients: Ingredient[];
  grain_free: boolean;
  meal_free: boolean;
  has_probiotics: boolean;
  has_cranberry: boolean;
  has_yucca: boolean;
  caution_ingredients: string[];
  data_verified_at: string | null;
  published_at: string | null;
  brands: BrandSummary | null;
  recalls?: RecallSummary[];
  prices?: PriceSummary[];
}

export type FoodRecord = Omit<FoodWithBrand, "recalls"> & {
  recalls?: RecallRecord[];
};

export interface RecallCarrier {
  brand_id: number;
  recalls?: RecallRecord[];
}

export type WithScopedRecalls<T extends RecallCarrier> = Omit<T, "recalls"> & {
  recalls: RecallSummary[];
};

export function attachRecallScopes<T extends RecallCarrier>(
  foods: readonly T[],
  brandRecalls: readonly RecallRecord[],
): WithScopedRecalls<T>[] {
  return foods.map((food) => {
    const recalledById = new Map<number, RecallSummary>();
    for (const recall of food.recalls ?? []) {
      recalledById.set(recall.id, { ...recall, scope: "product" });
    }
    for (const recall of brandRecalls) {
      if (recall.food_id !== null || recall.brand_id !== food.brand_id)
        continue;
      recalledById.set(recall.id, { ...recall, scope: "brand" });
    }

    return {
      ...food,
      recalls: [...recalledById.values()].sort((left, right) =>
        (right.recall_date ?? "").localeCompare(left.recall_date ?? ""),
      ),
    };
  });
}

export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return !!url && !!key && !url.includes("xxxx") && key.length > 10;
}

export async function loadPublicFoods(
  supabase: SupabaseClient<Database>,
): Promise<FoodWithBrand[]> {
  const { data, error } = await supabase
    .from("foods")
    .select(
      `
      *,
      brands:brand_id (id, name, manufacturer, importer, country),
      recalls (id, brand_id, food_id, source, source_url, external_id, recalling_firm, reason, classification, affected_lots, recall_date, region)
    `,
    )
    .not("published_at", "is", null)
    .order("product_name", { ascending: true });

  if (error) throw error;

  const foods = (data ?? []) as unknown as FoodRecord[];
  const brandIds = [...new Set(foods.map((food) => food.brand_id))];
  if (brandIds.length === 0) return [];

  const { data: brandRecallData, error: brandRecallError } = await supabase
    .from("recalls")
    .select(
      "id, brand_id, food_id, source, source_url, external_id, recalling_firm, reason, classification, affected_lots, recall_date, region",
    )
    .is("food_id", null)
    .in("brand_id", brandIds)
    .order("recall_date", { ascending: false, nullsFirst: false });

  if (brandRecallError) throw brandRecallError;

  return attachRecallScopes(
    foods,
    (brandRecallData ?? []) as unknown as RecallRecord[],
  );
}

export interface NutrientEvidence {
  nutrient_key: NutrientSourceKey;
  value: number;
  excerpt: string;
  captured_at: string;
  source: { url: string; kind: string; capture_method: string };
}

// food_sources 는 컬럼 단위로만 열려 있다. `*` 나 생략형은 permission denied 로 전체
// 쿼리를 실패시키므로 임베디드 컬럼을 반드시 나열한다. !inner 는 소스가 RLS 로 가려진
// 근거를 통째로 떨어뜨린다 — 출처 없는 인용문은 보여주지 않는다는 규칙과 같다.
const FOOD_EVIDENCE_SELECT =
  "nutrient_key, value, excerpt, captured_at, food_sources!inner(url, kind, capture_method)";

export async function loadFoodEvidence(
  supabase: SupabaseClient<Database>,
  foodId: number,
): Promise<NutrientEvidence[]> {
  const { data, error } = await supabase
    .from("food_nutrient_evidence")
    .select(FOOD_EVIDENCE_SELECT)
    .eq("food_id", foodId)
    .eq("is_current", true);

  if (error) throw error;

  return (data ?? []).map((row) => {
    const { food_sources: source, ...rest } = row as unknown as Omit<
      NutrientEvidence,
      "source"
    > & { food_sources: NutrientEvidence["source"] };
    return { ...rest, source };
  });
}

export async function getFoodEvidence(
  foodId: number,
): Promise<NutrientEvidence[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    return await unstable_cache(
      async () => loadFoodEvidence(createPublicClient(), foodId),
      ["public-food-evidence", String(foodId)],
      { revalidate: 3600, tags: ["public-foods"] },
    )();
  } catch (error) {
    console.error("Failed to load food evidence", error);
    return [];
  }
}

export async function loadPublicRecalls(
  supabase: SupabaseClient<Database>,
): Promise<RecallSummary[]> {
  const { data, error } = await supabase
    .from("recalls")
    .select("*")
    .order("recall_date", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) throw error;

  return ((data ?? []) as RecallRecord[]).map((recall) => ({
    ...recall,
    scope: classifyRecallScope(recall),
  }));
}

const loadCachedPublicFoods = unstable_cache(
  async () => loadPublicFoods(createPublicClient()),
  ["public-foods"],
  { revalidate: 3600, tags: ["public-foods"] },
);

const loadCachedPublicRecalls = unstable_cache(
  async () => loadPublicRecalls(createPublicClient()),
  ["public-recalls"],
  { revalidate: 3600, tags: ["public-recalls"] },
);

export async function getFoods(): Promise<FoodWithBrand[]> {
  if (!isSupabaseConfigured()) return SAMPLE_FOODS;

  try {
    return await loadCachedPublicFoods();
  } catch (error) {
    console.error("Failed to load foods", error);
    return [];
  }
}

export async function getFood(id: number) {
  const foods = await getFoods();
  return foods.find((food) => food.id === id) ?? null;
}

export function orderComparisonFoods(
  foods: readonly FoodWithBrand[],
  ids: readonly number[],
): FoodWithBrand[] {
  const foodsById = new Map(foods.map((food) => [food.id, food]));
  const selectedIds = new Set<number>();
  const selected: FoodWithBrand[] = [];

  for (const id of ids) {
    if (selectedIds.has(id)) continue;
    selectedIds.add(id);
    const food = foodsById.get(id);
    if (food) selected.push(food);
  }

  return selected;
}

export async function getComparisonFoods(ids: number[]) {
  if (ids.length === 0) return [];
  const foods = await getFoods();
  return orderComparisonFoods(foods, ids);
}

export async function getRecalls(): Promise<RecallSummary[]> {
  if (!isSupabaseConfigured())
    return SAMPLE_FOODS.flatMap((food) => food.recalls ?? []);

  try {
    return await loadCachedPublicRecalls();
  } catch (error) {
    console.error("Failed to load recalls", error);
    return [];
  }
}
