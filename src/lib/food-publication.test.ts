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
  energyCPct: null,
  energyFPct: null,
  energyPPct: null,
  fatPct: 18,
  fiberPct: 4,
  kcalPerKg: 3850,
  manufacturerText: null,
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
  it("keeps a manufacturer-declared P/F/C split instead of recalculating it", () => {
    const result = prepareFoodPublication({
      ...validDraft,
      energyCPct: 20,
      energyFPct: 42,
      energyPPct: 38,
      nutrientSources: {
        ...validDraft.nutrientSources,
        energy_c_pct: "manufacturer",
        energy_f_pct: "manufacturer",
        energy_p_pct: "manufacturer",
      },
    });

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      // 재계산했다면 36.2 / 40.7 / 23.1이 나온다.
      expect(result.derived).toMatchObject({
        energyCPct: 20,
        energyFPct: 42,
        energyPPct: 38,
      });
      expect(result.derived.nutrientSources).toMatchObject({
        energy_c_pct: "manufacturer",
        energy_f_pct: "manufacturer",
        energy_p_pct: "manufacturer",
      });
    }
  });

  it("refuses a declared P/F/C split that does not sum to 100", () => {
    // 자릿수가 빠진 열량비(7/20/10)는 실측 태그를 달고 공개되면 안 된다. 이전에는
    // validate가 재계산값을 보고 선언값을 실었기 때문에 이 검사가 돌지 않았다.
    const result = prepareFoodPublication({
      ...validDraft,
      energyCPct: 10,
      energyFPct: 20,
      energyPPct: 7,
      nutrientSources: {
        ...validDraft.nutrientSources,
        energy_c_pct: "manufacturer",
        energy_f_pct: "manufacturer",
        energy_p_pct: "manufacturer",
      },
    });

    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.message).toContain("열량비 합계");
    }
  });

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

  // source-first 경로는 P/F/C를 컬럼에 남기지 않으므로, 명시값은 보관 원문에서만
  // 발견된다. 이 연결이 없으면 제조사가 선언한 값이 NFE 역산값으로 덮인다.
  it("보관된 제조사 원문의 명시 P/F/C를 역산값보다 우선한다", () => {
    const result = prepareFoodPublication({
      ...validDraft,
      manufacturerText:
        "Metabolizable Energy is 3975 kcal/kg (497 kcal per 250ml cup) " +
        "from 38% from protein, 21% from carbohydrates and 41% from fat.",
    });

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      // 역산했다면 36.2 / 40.7 / 23.1이 나온다.
      expect(result.derived).toMatchObject({
        energyCPct: 21,
        energyFPct: 41,
        energyPPct: 38,
      });
      expect(result.derived.nutrientSources).toMatchObject({
        energy_c_pct: "manufacturer",
        energy_f_pct: "manufacturer",
        energy_p_pct: "manufacturer",
      });
    }
  });

  it("원문에 P/F/C가 일부만 있으면 통째로 버리고 역산한다", () => {
    const result = prepareFoodPublication({
      ...validDraft,
      manufacturerText: "38% from protein, and the rest is unstated.",
    });

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.derived).toMatchObject({
        energyCPct: 23.1,
        energyFPct: 40.7,
        energyPPct: 36.2,
      });
      expect(result.derived.nutrientSources.energy_p_pct).toBe("derived");
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
