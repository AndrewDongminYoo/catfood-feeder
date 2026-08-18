import type {
  FoodWithBrand,
  NutrientEvidence,
  NutrientSourceKey,
} from "@/lib/catalog";
import type { Source } from "@/lib/domain";
import { resolveAsh } from "@/lib/domain";
import { formatKcal, formatPct, formatRatio } from "@/lib/format";

export type EvidenceTone = "declared" | "estimated" | "derived" | "unknown";

export type EvidenceState = {
  label: "제조사 표기" | "국내 라벨 표기" | "추정값" | "계산값" | "미기록";
  tone: EvidenceTone;
};

export type NutritionPresentationKey = NutrientSourceKey | "ca_p_ratio";

export type NutritionProof =
  | {
      kind: "quoted";
      excerpt: string;
      value: number;
      url: string;
      capturedAt: string;
      captureMethod: string;
    }
  | {
      kind: "computed";
      formula: string;
      inputs: readonly NutritionPresentationKey[];
    };

export type NutritionFact = {
  key: NutritionPresentationKey;
  label: string;
  value: string;
  evidence: EvidenceState;
  note: string | null;
  proof: NutritionProof | null;
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

function quotedProof(
  evidence: NutrientEvidence | undefined,
): NutritionProof | null {
  if (!evidence) return null;
  return {
    captureMethod: evidence.source.capture_method,
    capturedAt: evidence.captured_at,
    excerpt: evidence.excerpt,
    kind: "quoted",
    url: evidence.source.url,
    value: evidence.value,
  };
}

// 탄수화물은 no evidence 만으로는 "계산값"이라 단정할 수 없다 — Supabase 미설정 시
// SAMPLE_FOODS 폴백에는 evidence 행이 애초에 존재하지 않으므로, 제조사가 명시한
// 값도 이 조건만으로는 역산값처럼 보이게 된다. nutrient_sources.carb_pct가
// "derived"일 때만 수식을 붙인다.
function carbProof(
  food: FoodWithBrand,
  evidence: NutrientEvidence | undefined,
): NutritionProof | null {
  const quoted = quotedProof(evidence);
  if (quoted) return quoted;
  if (food.nutrient_sources.carb_pct !== "derived") return null;
  if (food.carb_pct === null) return null;

  const ash = resolveAsh(
    food.ash_pct,
    food.nutrient_sources.ash_pct ?? null,
    food.cooking_method,
  );
  if (ash.value === null) return null;

  const terms = [
    food.protein_pct,
    food.fat_pct,
    food.fiber_pct,
    food.moisture_pct,
  ];
  if (terms.some((term) => term === null)) return null;

  return {
    formula: `100 − (${terms.join(" + ")} + ${ash.value}${ash.estimated ? " 추정" : ""}) = ${food.carb_pct}`,
    inputs: ["protein_pct", "fat_pct", "fiber_pct", "moisture_pct", "ash_pct"],
    kind: "computed",
  };
}

// Ca:P는 생성 컬럼이라 evidence 행이 애초에 없다 — source 태그가 아니라 입력값
// 존재 여부로 게이팅한다.
function caPRatioProof(food: FoodWithBrand): NutritionProof | null {
  if (
    food.calcium_pct === null ||
    food.phosphorus_pct === null ||
    food.ca_p_ratio === null
  ) {
    return null;
  }
  return {
    formula: `${food.calcium_pct} ÷ ${food.phosphorus_pct} = ${food.ca_p_ratio}`,
    inputs: ["calcium_pct", "phosphorus_pct"],
    kind: "computed",
  };
}

function foodFact(
  food: FoodWithBrand,
  key: NutrientSourceKey,
  label: string,
  value: number | null,
  format: (value: number | null) => string,
  proof: NutritionProof | null,
  note: string | null = null,
): NutritionFact {
  return {
    evidence: evidenceState(food.nutrient_sources[key], value),
    key,
    label,
    note,
    proof,
    value: format(value),
  };
}

export function nutritionFacts(
  food: FoodWithBrand,
  evidence: readonly NutrientEvidence[] = [],
): readonly NutritionFact[] {
  const evidenceByKey = new Map(evidence.map((e) => [e.nutrient_key, e]));
  const carbSource = food.nutrient_sources.carb_pct;

  return [
    foodFact(
      food,
      "protein_pct",
      "단백질",
      food.protein_pct,
      formatPct,
      quotedProof(evidenceByKey.get("protein_pct")),
    ),
    foodFact(
      food,
      "fat_pct",
      "지방",
      food.fat_pct,
      formatPct,
      quotedProof(evidenceByKey.get("fat_pct")),
    ),
    foodFact(
      food,
      "carb_pct",
      "탄수화물",
      food.carb_pct,
      formatPct,
      carbProof(food, evidenceByKey.get("carb_pct")),
      carbSource === "manufacturer" || carbSource === "kr_label"
        ? null
        : "탄수화물 수치는 근거 상태와 함께 확인하세요.",
    ),
    foodFact(
      food,
      "kcal_per_kg",
      "열량 밀도",
      food.kcal_per_kg,
      formatKcal,
      quotedProof(evidenceByKey.get("kcal_per_kg")),
    ),
    foodFact(
      food,
      "energy_p_pct",
      "단백질 열량비",
      food.energy_p_pct,
      formatPct,
      null,
      "열량 구성은 생애주기와 신체 상태를 함께 고려해 읽으세요.",
    ),
    foodFact(
      food,
      "energy_f_pct",
      "지방 열량비",
      food.energy_f_pct,
      formatPct,
      null,
    ),
    foodFact(
      food,
      "energy_c_pct",
      "탄수화물 열량비",
      food.energy_c_pct,
      formatPct,
      null,
    ),
    {
      evidence: evidenceState(
        food.ca_p_ratio === null ? undefined : "derived",
        food.ca_p_ratio,
      ),
      key: "ca_p_ratio",
      label: "Ca:P",
      note: "Ca:P는 높고 낮음보다 비율 자체를 확인할 지표입니다.",
      proof: caPRatioProof(food),
      value: formatRatio(food.ca_p_ratio),
    },
  ];
}
