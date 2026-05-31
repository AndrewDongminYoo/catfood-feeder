import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, type FoodWithBrand } from "@/lib/catalog";

export interface FeedingFood {
  id: number;
  product_name: string;
  protein_pct: number | null;
  fat_pct: number | null;
  carb_pct: number | null;
  kcal_per_kg: number | null;
  energy_p_pct: number | null;
  energy_f_pct: number | null;
  energy_c_pct: number | null;
  brands: { name: string } | null;
  recalls?: { id: number; reason: string | null }[];
}

export interface FeedingLog {
  id: number;
  started_on: string;
  ended_on: string | null;
  note: string | null;
  foods: FeedingFood | null;
}

export interface CatProfile {
  id: number;
  name: string;
  birth_date: string | null;
  feeding_logs: FeedingLog[];
}

export interface FeedingInsight {
  catName: string;
  fromFood: string;
  toFood: string;
  messages: string[];
}

export async function getFeedingDashboard() {
  if (!isSupabaseConfigured()) {
    return { user: null, cats: [], insights: [], configured: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, cats: [], insights: [], configured: true };

  const { data, error } = await supabase
    .from("cats")
    .select(
      `
      id,
      name,
      birth_date,
      feeding_logs (
        id,
        started_on,
        ended_on,
        note,
        foods (
          id,
          product_name,
          protein_pct,
          fat_pct,
          carb_pct,
          kcal_per_kg,
          energy_p_pct,
          energy_f_pct,
          energy_c_pct,
          brands (name),
          recalls (id, reason)
        )
      )
    `,
    )
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load feeding dashboard", error);
    return { user, cats: [], insights: [], configured: true };
  }

  const cats = ((data ?? []) as unknown as CatProfile[]).map((cat) => ({
    ...cat,
    feeding_logs: [...(cat.feeding_logs ?? [])].sort((a, b) =>
      b.started_on.localeCompare(a.started_on),
    ),
  }));

  return { user, cats, insights: buildFeedingInsights(cats), configured: true };
}

export function buildFeedingInsights(cats: CatProfile[]): FeedingInsight[] {
  const insights: FeedingInsight[] = [];

  for (const cat of cats) {
    const logs = [...cat.feeding_logs]
      .filter((log) => log.foods)
      .sort((a, b) => a.started_on.localeCompare(b.started_on));

    for (let i = 1; i < logs.length; i += 1) {
      const prev = logs[i - 1]?.foods;
      const next = logs[i]?.foods;
      if (!prev || !next) continue;

      const messages = compareFoodTransition(prev, next);
      if (messages.length > 0) {
        insights.push({
          catName: cat.name,
          fromFood: displayFoodName(prev),
          toFood: displayFoodName(next),
          messages,
        });
      }
    }
  }

  for (const cat of cats) {
    const current = cat.feeding_logs.find((log) => !log.ended_on && log.foods);
    const recalls = current?.foods?.recalls ?? [];
    if (current?.foods && recalls.length > 0) {
      insights.push({
        catName: cat.name,
        fromFood: displayFoodName(current.foods),
        toFood: displayFoodName(current.foods),
        messages: ["현재 급여 중인 제품에 연결된 리콜 이력이 있습니다."],
      });
    }
  }

  return insights;
}

export function compareFoodTransition(
  prev: Pick<
    FoodWithBrand,
    | "product_name"
    | "protein_pct"
    | "fat_pct"
    | "carb_pct"
    | "kcal_per_kg"
    | "energy_p_pct"
    | "energy_f_pct"
    | "energy_c_pct"
  >,
  next: Pick<
    FoodWithBrand,
    | "product_name"
    | "protein_pct"
    | "fat_pct"
    | "carb_pct"
    | "kcal_per_kg"
    | "energy_p_pct"
    | "energy_f_pct"
    | "energy_c_pct"
  >,
) {
  const messages: string[] = [];
  const kcalDelta = deltaPct(prev.kcal_per_kg, next.kcal_per_kg);
  if (kcalDelta !== null && Math.abs(kcalDelta) >= 10) {
    messages.push(`열량 ${Math.round(kcalDelta)}% 변화`);
  }

  for (const [label, before, after] of [
    ["단백질 열량비", prev.energy_p_pct, next.energy_p_pct],
    ["지방 열량비", prev.energy_f_pct, next.energy_f_pct],
    ["탄수 열량비", prev.energy_c_pct, next.energy_c_pct],
  ] as const) {
    if (before !== null && after !== null && Math.abs(after - before) >= 8) {
      messages.push(`${label} ${Math.round(after - before)}%p 변화`);
    }
  }

  return messages;
}

function deltaPct(before: number | null, after: number | null) {
  if (!before || !after) return null;
  return ((after - before) / before) * 100;
}

function displayFoodName(food: FeedingFood) {
  return `${food.brands?.name ? `${food.brands.name} ` : ""}${food.product_name}`;
}
