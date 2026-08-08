import { computeDerived, parseManufacturerEnergy, validate } from "./domain";
import { z } from "zod";
import type { CookingMethod, NutrientInput, Source } from "./domain";

export type FoodPublicationDraft = {
  readonly ashPct: number | null;
  readonly calciumPct: number | null;
  /** 저장된 탄수화물. `nutrient_sources.carb_pct`가 실측 태그일 때만 라벨 선언값이다. */
  readonly carbPct: number | null;
  readonly cookingMethod: CookingMethod | null;
  /** 저장된 P/F/C. `nutrient_sources`가 manufacturer라면 제조사가 선언한 값이다. */
  readonly energyCPct: number | null;
  readonly energyFPct: number | null;
  readonly energyPPct: number | null;
  readonly fatPct: number | null;
  readonly fiberPct: number | null;
  readonly kcalPerKg: number | null;
  /**
   * 현재 manufacturer 출처의 보관 원문. source-first 경로는 P/F/C를 컬럼에 남기지
   * 않으므로(근거 적용은 측정 8개 키만 쓴다), 선언값은 여기서만 발견된다.
   */
  readonly manufacturerText: string | null;
  readonly moisturePct: number | null;
  readonly nutrientSources: Readonly<Record<string, Source>>;
  readonly phosphorusPct: number | null;
  readonly proteinPct: number | null;
  readonly updatedAt: string;
};

export type FoodPublicationPreparation =
  | {
      readonly derived: {
        readonly carbIsEstimated: boolean;
        readonly carbPct: number | null;
        readonly energyCPct: number | null;
        readonly energyFPct: number | null;
        readonly energyPPct: number | null;
        readonly nutrientSources: Readonly<Record<string, Source>>;
      };
      readonly expectedUpdatedAt: string;
      readonly kind: "ready";
    }
  | {
      readonly kind: "invalid";
      readonly message: string;
    };

export const publishFoodDraftResultSchema = z.discriminatedUnion("status", [
  z.object({
    published_at: z.iso.datetime({ offset: true }),
    status: z.literal("published"),
  }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("already_published") }),
  z.object({ status: z.literal("stale") }),
  z.object({ status: z.literal("no_evidence") }),
  z.object({
    nutrient_key: z.string().min(1),
    status: z.literal("missing_evidence"),
  }),
  z.object({
    nutrient_key: z.string().min(1),
    status: z.literal("evidence_mismatch"),
  }),
]);

export type PublishFoodDraftResult = Readonly<
  z.infer<typeof publishFoodDraftResultSchema>
>;

export function prepareFoodPublication(
  draft: FoodPublicationDraft,
): FoodPublicationPreparation {
  // 라벨이 NFE를 직접 쓴 경우에만 저장된 carb를 실측으로 넘긴다. 계산으로 채워진
  // 값을 다시 넘기면 역산 결과가 자기 자신을 입력으로 삼아 실측으로 굳어버린다.
  const statedCarb = isMeasured(draft.nutrientSources.carb_pct)
    ? draft.carbPct
    : null;
  const nutrients: NutrientInput = {
    ash_pct: draft.ashPct,
    calcium_pct: draft.calciumPct,
    carb_pct: statedCarb,
    fat_pct: draft.fatPct,
    fiber_pct: draft.fiberPct,
    kcal_per_kg: draft.kcalPerKg,
    moisture_pct: draft.moisturePct,
    phosphorus_pct: draft.phosphorusPct,
    protein_pct: draft.proteinPct,
  };
  // 제조사가 P/F/C를 직접 선언한 DRAFT는 발행이 다시 계산하지 않는다. 재계산하면
  // 선언값이 NFE 역산값으로 바뀌고 출처 태그도 manufacturer에서 derived로 떨어져,
  // 측정값을 파생값으로 둔갑시키게 된다.
  //
  // 선언값은 computeDerived에 그대로 넘긴다. 계산 뒤에 끼워 넣으면 validate가
  // 발행되지 않는 값을 검사하고 검사되지 않은 값을 발행하게 되어, 자릿수가 빠진
  // 열량비(예: 7/20/10)가 "실측"으로 공개된다 — domain.ts의 합계 검사는 바로
  // 그것을 막으려고 있는데 이 경로에서만 한 번도 돌지 않았다.
  const declaredEnergy = hasDeclaredEnergy(draft)
    ? {
        c: draft.energyCPct,
        f: draft.energyFPct,
        p: draft.energyPPct,
      }
    : parseDeclaredEnergyFromSource(draft.manufacturerText);
  const derived = computeDerived(
    nutrients,
    draft.cookingMethod,
    draft.nutrientSources.ash_pct ?? null,
    declaredEnergy,
  );
  const blockingErrors = validate(nutrients, derived).filter(
    (flag) => flag.level === "error",
  );
  if (blockingErrors.length > 0) {
    return {
      kind: "invalid",
      message: blockingErrors.map((flag) => flag.msg).join(" / "),
    };
  }

  const nutrientSources: Record<string, Source> = {
    ...draft.nutrientSources,
  };
  // 실측 carb는 태그를 그대로 둔다. 여기서 derived로 덮으면 라벨이 쓴 값이
  // 계산값으로 둔갑해 measured/estimated 구분이 무너진다.
  if (statedCarb === null && derived.carb_pct !== null) {
    nutrientSources.carb_pct = derived.carb_is_estimated
      ? "estimated"
      : "derived";
  }
  if (derived.energy_p_pct !== null) {
    const energySource: Source =
      declaredEnergy === undefined ? "derived" : "manufacturer";
    nutrientSources.energy_p_pct = energySource;
    nutrientSources.energy_f_pct = energySource;
    nutrientSources.energy_c_pct = energySource;
  }

  return {
    derived: {
      carbIsEstimated: derived.carb_is_estimated,
      carbPct: derived.carb_pct,
      energyCPct: derived.energy_c_pct,
      energyFPct: derived.energy_f_pct,
      energyPPct: derived.energy_p_pct,
      nutrientSources,
    },
    expectedUpdatedAt: draft.updatedAt,
    kind: "ready",
  };
}

/**
 * 저장된 P/F/C가 제조사 선언값인지. 세 값이 모두 있고 태그가 manufacturer일 때만
 * 참이며, 그때는 발행이 재계산 대신 이 값을 검증해서 그대로 싣는다.
 */
/** 라벨에서 온 값인가. derived/estimated는 계산 산물이므로 실측이 아니다. */
function isMeasured(source: Source | undefined): boolean {
  return source === "manufacturer" || source === "kr_label";
}

function hasDeclaredEnergy(draft: FoodPublicationDraft): boolean {
  return (
    draft.nutrientSources.energy_p_pct === "manufacturer" &&
    draft.energyPPct !== null &&
    draft.energyFPct !== null &&
    draft.energyCPct !== null
  );
}

/**
 * 보관된 제조사 원문에 P/F/C가 명시돼 있으면 그것을 선언값으로 쓴다. BLUEPRINT의
 * 2경로 규칙("제조사가 명시하면 그대로")은 `/api/extract` 경로에만 연결돼 있어서,
 * source-first 경로로 들어온 사료는 명시값이 원문에 있는데도 NFE 역산값이 실렸다.
 *
 * 셋 중 하나라도 빠지면 통째로 버린다 — 부분 선언값을 역산값과 섞으면 어느 쪽도
 * 아닌 숫자가 manufacturer로 태깅된다.
 */
function parseDeclaredEnergyFromSource(
  manufacturerText: string | null,
): { c: number; f: number; p: number } | undefined {
  if (manufacturerText === null) return undefined;
  const parsed = parseManufacturerEnergy(manufacturerText);
  if (parsed === null) return undefined;
  const { c, f, p } = parsed;
  if (c === null || f === null || p === null) return undefined;
  return { c, f, p };
}
