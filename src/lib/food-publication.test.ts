import { describe, expect, it } from "vitest";
import {
  prepareFoodPublication,
  publishFoodDraftResultSchema,
  type FoodPublicationDraft,
} from "./food-publication";

const validDraft: FoodPublicationDraft = {
  ashPct: 9,
  calciumPct: 1.6,
  cookingMethod: "extrusion",
  fatPct: 18,
  fiberPct: 4,
  kcalPerKg: 3850,
  moisturePct: 10,
  nutrientSources: {
    ash_pct: "kr_label",
    calcium_pct: "manufacturer",
    fat_pct: "manufacturer",
    fiber_pct: "manufacturer",
    kcal_per_kg: "manufacturer",
    moisture_pct: "manufacturer",
    phosphorus_pct: "manufacturer",
    protein_pct: "manufacturer",
  },
  phosphorusPct: 1.2,
  proteinPct: 36,
  updatedAt: "2026-08-05T10:00:00.000Z",
};

describe("prepareFoodPublication", () => {
  it("prepares derived values when an evidence-backed draft is valid", () => {
    const result = prepareFoodPublication(validDraft);

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.expectedUpdatedAt).toBe("2026-08-05T10:00:00.000Z");
      expect(result.derived).toMatchObject({
        carbIsEstimated: false,
        carbPct: 23,
        energyCPct: 23.1,
        energyFPct: 40.7,
        energyPPct: 36.2,
      });
      expect(result.derived.nutrientSources).toMatchObject({
        carb_pct: "derived",
        energy_c_pct: "derived",
        energy_f_pct: "derived",
        energy_p_pct: "derived",
        protein_pct: "manufacturer",
      });
    }
  });

  it("returns the blocking domain message instead of preparing invalid data", () => {
    const result = prepareFoodPublication({
      ...validDraft,
      fatPct: 70,
      moisturePct: null,
      proteinPct: 50,
    });

    expect(result).toEqual({
      kind: "invalid",
      message: "보장성분 합계 133% — 100% 초과(입력 오류 가능)",
    });
  });

  it("marks carbohydrate and energy sources as estimated or derived", () => {
    const result = prepareFoodPublication({
      ...validDraft,
      ashPct: null,
      nutrientSources: {
        fat_pct: "manufacturer",
        fiber_pct: "manufacturer",
        moisture_pct: "manufacturer",
        protein_pct: "manufacturer",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.derived.carbIsEstimated).toBe(true);
      expect(result.derived.nutrientSources.carb_pct).toBe("estimated");
      expect(result.derived.nutrientSources.energy_p_pct).toBe("derived");
      expect(result.derived.nutrientSources).not.toHaveProperty("ash_pct");
    }
  });
});

describe("publishFoodDraftResultSchema", () => {
  it.each([
    {
      published_at: "2026-08-05T10:00:00+00:00",
      status: "published",
    },
    { status: "not_found" },
    { status: "already_published" },
    { status: "stale" },
    { status: "no_evidence" },
    { nutrient_key: "fat_pct", status: "missing_evidence" },
    { nutrient_key: "protein_pct", status: "evidence_mismatch" },
  ])("accepts $status", (result) => {
    expect(publishFoodDraftResultSchema.parse(result)).toEqual(result);
  });

  it.each([
    { published_at: "not-a-date", status: "published" },
    { nutrient_key: "", status: "missing_evidence" },
    { status: "unexpected" },
    null,
  ])("rejects malformed RPC JSON %#", (result) => {
    expect(publishFoodDraftResultSchema.safeParse(result).success).toBe(false);
  });
});
