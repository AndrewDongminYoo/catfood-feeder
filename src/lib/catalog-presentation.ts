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

/** 공개 상세면이 쓰는 지표 이름. 계산 근거의 입력 항목도 같은 이름을 쓴다. */
const NUTRITION_LABELS: Record<NutritionPresentationKey, string> = {
  ash_pct: "조회분",
  ca_p_ratio: "Ca:P",
  calcium_pct: "칼슘",
  carb_pct: "탄수화물",
  energy_c_pct: "탄수화물 열량비",
  energy_f_pct: "지방 열량비",
  energy_p_pct: "단백질 열량비",
  fat_pct: "지방",
  fiber_pct: "조섬유",
  kcal_per_kg: "열량 밀도",
  moisture_pct: "수분",
  phosphorus_pct: "인",
  protein_pct: "단백질",
};

export type QuotedProof = {
  kind: "quoted";
  excerpt: string;
  value: number;
  url: string;
  capturedAt: string;
  captureMethod: string;
};

/**
 * 계산 근거의 항 하나. 근거 행이 없는 항(익스트루전 회분 폴백이 대표적)은
 * proof 가 null 이고, 그 사실은 evidence 배지가 그 자리에서 말한다.
 */
export type NutritionProofInput = {
  key: NutritionPresentationKey;
  label: string;
  value: string;
  evidence: EvidenceState;
  proof: QuotedProof | null;
};

export type NutritionProof =
  | QuotedProof
  | {
      kind: "computed";
      formula: string;
      inputs: readonly NutritionProofInput[];
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

// 표시값과 인용문의 값이 어긋나면 인용을 붙이지 않는다. 두 값은 각자 1시간짜리
// 캐시(`public-foods` / `public-food-evidence`)를 거쳐 서로 다른 시점을 담을 수
// 있고, 위에 적힌 수치와 다른 숫자를 표시하는 근거는 스스로를 반증한다.
function quotedProof(
  evidence: NutrientEvidence | undefined,
  value: number | null,
): QuotedProof | null {
  if (!evidence || value === null || evidence.value !== value) return null;
  return {
    captureMethod: evidence.source.capture_method,
    capturedAt: evidence.captured_at,
    excerpt: evidence.excerpt,
    kind: "quoted",
    url: evidence.source.url,
    value: evidence.value,
  };
}

type EvidenceByKey = ReadonlyMap<string, NutrientEvidence>;

function proofInput(
  key: NutritionPresentationKey,
  value: number | null,
  source: Source | undefined,
  evidence: NutrientEvidence | undefined,
): NutritionProofInput {
  return {
    evidence: evidenceState(source, value),
    key,
    label: NUTRITION_LABELS[key],
    proof: quotedProof(evidence, value),
    value: formatPct(value),
  };
}

// 탄수화물은 no evidence 만으로는 "계산값"이라 단정할 수 없다 — Supabase 미설정 시
// SAMPLE_FOODS 폴백에는 evidence 행이 애초에 존재하지 않으므로, 제조사가 명시한
// 값도 이 조건만으로는 역산값처럼 보이게 된다. nutrient_sources.carb_pct가
// "derived" 또는 "estimated"(익스트루전 회분 폴백 경유)일 때만 수식을 붙인다 —
// 두 태그 모두 "제조사/국내 라벨이 직접 쓰지 않았다"는 뜻이고, evidence 없음
// 검사가 이미 실측(manufacturer/kr_label) 오분류를 막는다.
function carbProof(
  food: FoodWithBrand,
  evidenceByKey: EvidenceByKey,
): NutritionProof | null {
  const quoted = quotedProof(evidenceByKey.get("carb_pct"), food.carb_pct);
  if (quoted) return quoted;
  const carbSource = food.nutrient_sources.carb_pct;
  if (carbSource !== "derived" && carbSource !== "estimated") return null;
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
    // 회분 항은 원본 컬럼이 아니라 resolveAsh 결과가 수식에 들어간다. 폴백으로 받은
    // 9.0%는 인용할 구절이 없으므로, 그 자리에서 "추정값"이라고만 말한다 —
    // 같은 값을 가진 지난 근거 행이 있어도 붙이지 않는다.
    inputs: [
      proofInput(
        "protein_pct",
        food.protein_pct,
        food.nutrient_sources.protein_pct,
        evidenceByKey.get("protein_pct"),
      ),
      proofInput(
        "fat_pct",
        food.fat_pct,
        food.nutrient_sources.fat_pct,
        evidenceByKey.get("fat_pct"),
      ),
      proofInput(
        "fiber_pct",
        food.fiber_pct,
        food.nutrient_sources.fiber_pct,
        evidenceByKey.get("fiber_pct"),
      ),
      proofInput(
        "moisture_pct",
        food.moisture_pct,
        food.nutrient_sources.moisture_pct,
        evidenceByKey.get("moisture_pct"),
      ),
      proofInput(
        "ash_pct",
        ash.value,
        ash.estimated ? "estimated" : food.nutrient_sources.ash_pct,
        ash.estimated ? undefined : evidenceByKey.get("ash_pct"),
      ),
    ],
    kind: "computed",
  };
}

// Ca:P는 생성 컬럼이라 evidence 행이 애초에 없다 — source 태그가 아니라 입력값
// 존재 여부로 게이팅한다.
function caPRatioProof(
  food: FoodWithBrand,
  evidenceByKey: EvidenceByKey,
): NutritionProof | null {
  if (
    food.calcium_pct === null ||
    food.phosphorus_pct === null ||
    food.ca_p_ratio === null
  ) {
    return null;
  }
  return {
    formula: `${food.calcium_pct} ÷ ${food.phosphorus_pct} = ${food.ca_p_ratio}`,
    inputs: [
      proofInput(
        "calcium_pct",
        food.calcium_pct,
        food.nutrient_sources.calcium_pct,
        evidenceByKey.get("calcium_pct"),
      ),
      proofInput(
        "phosphorus_pct",
        food.phosphorus_pct,
        food.nutrient_sources.phosphorus_pct,
        evidenceByKey.get("phosphorus_pct"),
      ),
    ],
    kind: "computed",
  };
}

function foodFact(
  food: FoodWithBrand,
  key: NutrientSourceKey,
  value: number | null,
  format: (value: number | null) => string,
  proof: NutritionProof | null,
  note: string | null = null,
): NutritionFact {
  return {
    evidence: evidenceState(food.nutrient_sources[key], value),
    key,
    label: NUTRITION_LABELS[key],
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
      food.protein_pct,
      formatPct,
      quotedProof(evidenceByKey.get("protein_pct"), food.protein_pct),
    ),
    foodFact(
      food,
      "fat_pct",
      food.fat_pct,
      formatPct,
      quotedProof(evidenceByKey.get("fat_pct"), food.fat_pct),
    ),
    foodFact(
      food,
      "carb_pct",
      food.carb_pct,
      formatPct,
      carbProof(food, evidenceByKey),
      carbSource === "manufacturer" || carbSource === "kr_label"
        ? null
        : "탄수화물 수치는 근거 상태와 함께 확인하세요.",
    ),
    foodFact(
      food,
      "kcal_per_kg",
      food.kcal_per_kg,
      formatKcal,
      quotedProof(evidenceByKey.get("kcal_per_kg"), food.kcal_per_kg),
    ),
    foodFact(
      food,
      "energy_p_pct",
      food.energy_p_pct,
      formatPct,
      null,
      "열량 구성은 생애주기와 신체 상태를 함께 고려해 읽으세요.",
    ),
    foodFact(food, "energy_f_pct", food.energy_f_pct, formatPct, null),
    foodFact(food, "energy_c_pct", food.energy_c_pct, formatPct, null),
    {
      evidence: evidenceState(
        food.ca_p_ratio === null ? undefined : "derived",
        food.ca_p_ratio,
      ),
      key: "ca_p_ratio",
      label: NUTRITION_LABELS.ca_p_ratio,
      note: "Ca:P는 높고 낮음보다 비율 자체를 확인할 지표입니다.",
      proof: caPRatioProof(food, evidenceByKey),
      value: formatRatio(food.ca_p_ratio),
    },
  ];
}
