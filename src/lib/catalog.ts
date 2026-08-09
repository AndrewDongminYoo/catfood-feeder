import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { SAMPLE_FOODS } from "@/lib/fixtures";
import type { CookingMethod, NutrientKey, Source } from "@/lib/domain";

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

export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return !!url && !!key && !url.includes("xxxx") && key.length > 10;
}

export const getFoods = cache(async (): Promise<FoodWithBrand[]> => {
  if (!isSupabaseConfigured()) return SAMPLE_FOODS;

  const supabase = await createClient();
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
    .not("protein_pct", "is", null)
    .order("product_name", { ascending: true });

  if (error) {
    console.error("Failed to load foods", error);
    return [];
  }

  return (data ?? []) as unknown as FoodWithBrand[];
});

export async function getFood(id: number) {
  const foods = await getFoods();
  return foods.find((food) => food.id === id) ?? null;
}

export async function getComparisonFoods(ids: number[]) {
  if (ids.length === 0) return [];
  const foods = await getFoods();
  const wanted = new Set(ids);
  return foods.filter((food) => wanted.has(food.id));
}

export const getRecalls = cache(async (): Promise<RecallSummary[]> => {
  if (!isSupabaseConfigured())
    return SAMPLE_FOODS.flatMap((food) => food.recalls ?? []);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recalls")
    .select("*")
    .order("recall_date", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) {
    console.error("Failed to load recalls", error);
    return [];
  }

  return (data ?? []) as RecallSummary[];
});
