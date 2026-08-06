import { z } from "zod";
import { computeDerived, validate } from "./domain";
import type { CookingMethod, NutrientInput, Source } from "./domain";

export type FoodPublicationDraft = {
  readonly ashPct: number | null;
  readonly calciumPct: number | null;
  readonly cookingMethod: CookingMethod | null;
  /** 저장된 P/F/C. `nutrient_sources`가 manufacturer라면 제조사가 선언한 값이다. */
  readonly energyCPct: number | null;
  readonly energyFPct: number | null;
  readonly energyPPct: number | null;
  readonly fatPct: number | null;
  readonly fiberPct: number | null;
  readonly kcalPerKg: number | null;
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
  const nutrients: NutrientInput = {
    ash_pct: draft.ashPct,
    calcium_pct: draft.calciumPct,
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
    : undefined;
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
  if (derived.carb_pct !== null) {
    nutrientSources.carb_pct = derived.carb_is_estimated
      ? "estimated"
      : "derived";
  }
  if (declaredEnergy === undefined && derived.energy_p_pct !== null) {
    nutrientSources.energy_p_pct = "derived";
    nutrientSources.energy_f_pct = "derived";
    nutrientSources.energy_c_pct = "derived";
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
function hasDeclaredEnergy(draft: FoodPublicationDraft): boolean {
  return (
    draft.nutrientSources.energy_p_pct === "manufacturer" &&
    draft.energyPPct !== null &&
    draft.energyFPct !== null &&
    draft.energyCPct !== null
  );
}
