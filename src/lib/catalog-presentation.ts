import type { FoodWithBrand, NutrientSourceKey } from "@/lib/catalog";
import type { Source } from "@/lib/domain";
import { formatKcal, formatPct, formatRatio } from "@/lib/format";

export type EvidenceTone = "declared" | "estimated" | "derived" | "unknown";

export type EvidenceState = {
  label: "제조사 표기" | "국내 라벨 표기" | "추정값" | "계산값" | "미기록";
  tone: EvidenceTone;
};

export type NutritionPresentationKey = NutrientSourceKey | "ca_p_ratio";

export type NutritionFact = {
  key: NutritionPresentationKey;
  label: string;
  value: string;
  evidence: EvidenceState;
  note: string | null;
};

export function evidenceState(
  source: Source | undefined,
  value: number | null | undefined,
): EvidenceState {
  if (value === null || value === undefined || source === undefined) {
    return { label: "미기록", tone: "unknown" };
  }

  switch (source) {
    case "manufacturer":
      return { label: "제조사 표기", tone: "declared" };
    case "kr_label":
      return { label: "국내 라벨 표기", tone: "declared" };
    case "estimated":
      return { label: "추정값", tone: "estimated" };
    case "derived":
      return { label: "계산값", tone: "derived" };
  }
}

function foodFact(
  food: FoodWithBrand,
  key: NutrientSourceKey,
  label: string,
  value: number | null,
  format: (value: number | null) => string,
  note: string | null = null,
): NutritionFact {
  return {
    evidence: evidenceState(food.nutrient_sources[key], value),
    key,
    label,
    note,
    value: format(value),
  };
}

export function nutritionFacts(food: FoodWithBrand): readonly NutritionFact[] {
  const carbSource = food.nutrient_sources.carb_pct;

  return [
    foodFact(food, "protein_pct", "단백질", food.protein_pct, formatPct),
    foodFact(food, "fat_pct", "지방", food.fat_pct, formatPct),
    foodFact(
      food,
      "carb_pct",
      "탄수화물",
      food.carb_pct,
      formatPct,
      carbSource === "manufacturer" || carbSource === "kr_label"
        ? null
        : "탄수화물 수치는 근거 상태와 함께 확인하세요.",
    ),
    foodFact(food, "kcal_per_kg", "열량 밀도", food.kcal_per_kg, formatKcal),
    foodFact(
      food,
      "energy_p_pct",
      "단백질 열량비",
      food.energy_p_pct,
      formatPct,
      "열량 구성은 생애주기와 신체 상태를 함께 고려해 읽으세요.",
    ),
    foodFact(food, "energy_f_pct", "지방 열량비", food.energy_f_pct, formatPct),
    foodFact(
      food,
      "energy_c_pct",
      "탄수화물 열량비",
      food.energy_c_pct,
      formatPct,
    ),
    {
      evidence: evidenceState(
        food.ca_p_ratio === null ? undefined : "derived",
        food.ca_p_ratio,
      ),
      key: "ca_p_ratio",
      label: "Ca:P",
      note: "Ca:P는 높고 낮음보다 비율 자체를 확인할 지표입니다.",
      value: formatRatio(food.ca_p_ratio),
    },
  ];
}
