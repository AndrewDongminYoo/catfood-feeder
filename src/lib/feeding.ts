import { createClient } from "@/lib/supabase/server";
import {
  attachRecallScopes,
  isSupabaseConfigured,
  type FoodWithBrand,
  type RecallRecord,
  type RecallSummary,
} from "@/lib/catalog";

export interface FeedingFood {
  id: number;
  brand_id: number;
  product_name: string;
  protein_pct: number | null;
  fat_pct: number | null;
  carb_pct: number | null;
  kcal_per_kg: number | null;
  energy_p_pct: number | null;
  energy_f_pct: number | null;
  energy_c_pct: number | null;
  brands: { id: number; name: string } | null;
  recalls: RecallSummary[];
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

type FeedingFoodRecord = Omit<FeedingFood, "recalls"> & {
  recalls?: RecallRecord[];
};

type FeedingLogRecord = Omit<FeedingLog, "foods"> & {
  foods: FeedingFoodRecord | null;
};

type CatProfileRecord = Omit<CatProfile, "feeding_logs"> & {
  feeding_logs: FeedingLogRecord[];
};

const FEEDING_LOAD_ERROR = "급여 기록을 불러오지 못했습니다.";

export async function getFeedingDashboard() {
  if (!isSupabaseConfigured()) {
    return {
      user: null,
      cats: [],
      insights: [],
      configured: false,
      error: null,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user)
    return {
      user: null,
      cats: [],
      insights: [],
      configured: true,
      error: null,
    };

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
          brand_id,
          product_name,
          protein_pct,
          fat_pct,
          carb_pct,
          kcal_per_kg,
          energy_p_pct,
          energy_f_pct,
          energy_c_pct,
          brands (id, name),
          recalls (id, brand_id, food_id, source, source_url, external_id, recalling_firm, reason, classification, affected_lots, recall_date, region)
        )
      )
    `,
    )
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load feeding dashboard", error);
    return {
      user,
      cats: [],
      insights: [],
      configured: true,
      error: FEEDING_LOAD_ERROR,
    };
  }

  const catRecords = (data ?? []) as unknown as CatProfileRecord[];
  const foodRecords = catRecords.flatMap((cat) =>
    (cat.feeding_logs ?? []).flatMap((feedingLog) =>
      feedingLog.foods ? [feedingLog.foods] : [],
    ),
  );
  const brandIds = [...new Set(foodRecords.map((food) => food.brand_id))];
  let brandRecalls: RecallRecord[] = [];

  if (brandIds.length > 0) {
    const { data: brandRecallData, error: brandRecallError } = await supabase
      .from("recalls")
      .select(
        "id, brand_id, food_id, source, source_url, external_id, recalling_firm, reason, classification, affected_lots, recall_date, region",
      )
      .is("food_id", null)
      .in("brand_id", brandIds)
      .order("recall_date", { ascending: false, nullsFirst: false });

    if (brandRecallError) {
      console.error("Failed to load feeding recalls", brandRecallError);
      return {
        user,
        cats: [],
        insights: [],
        configured: true,
        error: FEEDING_LOAD_ERROR,
      };
    }

    brandRecalls = (brandRecallData ?? []) as unknown as RecallRecord[];
  }

  const scopedFoods = attachRecallScopes(foodRecords, brandRecalls);
  let foodIndex = 0;
  const cats: CatProfile[] = catRecords.map((cat) => ({
    ...cat,
    feeding_logs: [...(cat.feeding_logs ?? [])]
      .map((feedingLog) => ({
        ...feedingLog,
        foods: feedingLog.foods ? (scopedFoods[foodIndex++] ?? null) : null,
      }))
      .sort((a, b) => b.started_on.localeCompare(a.started_on)),
  }));

  return {
    user,
    cats,
    insights: buildFeedingInsights(cats),
    configured: true,
    error: null,
  };
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
      const messages: string[] = [];
      if (recalls.some((recall) => recall.scope === "product")) {
        messages.push(
          "현재 급여 중인 제품에 연결된 리콜 이력이 있습니다. 대상 로트를 원문에서 확인하세요.",
        );
      }
      if (recalls.some((recall) => recall.scope === "brand")) {
        messages.push(
          "현재 급여 중인 제품의 브랜드 범위 리콜 이력이 있습니다. 이 제품·로트의 해당 여부는 확인되지 않았습니다.",
        );
      }
      if (messages.length > 0) {
        insights.push({
          catName: cat.name,
          fromFood: displayFoodName(current.foods),
          toFood: displayFoodName(current.foods),
          messages,
        });
      }
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
