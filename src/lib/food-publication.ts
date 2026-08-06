import { z } from "zod";
import { computeDerived, validate } from "./domain";
import type { CookingMethod, NutrientInput, Source } from "./domain";

export type FoodPublicationDraft = {
  readonly ashPct: number | null;
  readonly calciumPct: number | null;
  readonly cookingMethod: CookingMethod | null;
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
  const derived = computeDerived(
    nutrients,
    draft.cookingMethod,
    draft.nutrientSources.ash_pct ?? null,
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
  if (derived.energy_p_pct !== null) {
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
