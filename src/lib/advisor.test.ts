import { describe, expect, it } from "vitest";
import type {
  AdvisorCatalogLoadResult,
  FoodWithBrand,
  NutrientEvidence,
} from "./catalog";
import { SAMPLE_FOODS } from "./fixtures";
import {
  classifyNutrientBound,
  findAdvisorCandidates,
  parseAdvisorSearchParams,
  type AdvisorQuery,
} from "./advisor";

describe("classifyNutrientBound", () => {
  it.each([
    ["조단백질 32% 이상", "minimum"],
    ["Crude Fat min. 18%", "minimum"],
    ["수분 10% 이하", "maximum"],
    ["Crude Fiber (max) 4%", "maximum"],
    ["Protein 32%", "unspecified"],
    ["minimum 30%, maximum 40%", "unspecified"],
    ["", "unspecified"],
  ] as const)(
    "%s의 문자 그대로인 경계를 %s로 분류한다",
    (excerpt, expected) => {
      expect(classifyNutrientBound(excerpt)).toBe(expected);
    },
  );

  it("유니코드 호환문자와 대소문자를 정규화한다", () => {
    expect(
      classifyNutrientBound("ＣＲＵＤＥ ＦＡＴ ＡＴ ＬＥＡＳＴ １８％"),
    ).toBe("minimum");
  });
});

describe("parseAdvisorSearchParams", () => {
  it("명시된 v0 검색 조건을 파싱한다", () => {
    expect(
      parseAdvisorSearchParams({
        cookingMethod: "baked",
        current: "42",
        declaredCarb: "1",
        kcalDelta: "10",
      }),
    ).toEqual({
      ok: true,
      query: {
        cookingMethod: "baked",
        currentFoodId: 42,
        maxKcalDeltaPct: 10,
        requireDeclaredCarb: true,
      },
    });
  });

  it("반복된 파라미터는 첫 값을 사용해 결정론적으로 정규화한다", () => {
    expect(
      parseAdvisorSearchParams({
        cookingMethod: ["freeze_dried", "extrusion"],
        current: ["7", "8"],
        declaredCarb: ["1", "0"],
        kcalDelta: ["5", "15"],
      }),
    ).toEqual({
      ok: true,
      query: {
        cookingMethod: "freeze_dried",
        currentFoodId: 7,
        maxKcalDeltaPct: 5,
        requireDeclaredCarb: true,
      },
    });
  });

  it.each([undefined, "", "0", "-1", "1.5", "food", "9007199254740992"])(
    "현재 사료 ID %s를 유효하지 않은 요청으로 거부한다",
    (current) => {
      expect(parseAdvisorSearchParams({ current })).toEqual({
        error: "invalid_current_food",
        ok: false,
      });
    },
  );

  it("지원하지 않는 선택 조건은 적용하지 않는다", () => {
    expect(
      parseAdvisorSearchParams({
        cookingMethod: "raw",
        current: "9",
        declaredCarb: "true",
        kcalDelta: "20",
      }),
    ).toEqual({
      ok: true,
      query: {
        cookingMethod: null,
        currentFoodId: 9,
        maxKcalDeltaPct: null,
        requireDeclaredCarb: false,
      },
    });
  });
});

function food(
  id: number,
  overrides: Partial<FoodWithBrand> = {},
): FoodWithBrand {
  return {
    ...SAMPLE_FOODS[0]!,
    id,
    brand_id: id,
    product_name: `Food ${id}`,
    brands: {
      ...SAMPLE_FOODS[0]!.brands!,
      id,
      name: `Brand ${id}`,
    },
    recalls: [],
    ...overrides,
  };
}

function evidence(
  nutrientKey: NutrientEvidence["nutrient_key"],
  value: number,
  excerpt: string,
): NutrientEvidence {
  return {
    captured_at: "2026-08-20T00:00:00Z",
    excerpt,
    nutrient_key: nutrientKey,
    source: { capture_method: "fetch", url: "https://example.test/label" },
    value,
  };
}

function catalog(
  foods: readonly FoodWithBrand[],
  evidenceRows: ReadonlyMap<number, readonly NutrientEvidence[]> = new Map(),
): Extract<AdvisorCatalogLoadResult, { available: true }> {
  return { available: true, evidenceByFoodId: evidenceRows, foods };
}

const baseQuery: AdvisorQuery = {
  cookingMethod: null,
  currentFoodId: 1,
  maxKcalDeltaPct: null,
  requireDeclaredCarb: false,
};

function readyCandidates(selection: ReturnType<typeof findAdvisorCandidates>) {
  if (selection.kind !== "ready") throw new Error("ready selection expected");
  return selection;
}

describe("findAdvisorCandidates", () => {
  it("returns a distinct state when the selected current food is absent", () => {
    expect(findAdvisorCandidates(catalog([food(2)]), baseQuery)).toEqual({
      kind: "current_food_not_found",
    });
  });

  it("never returns the current food and applies cooking method as a hard filter", () => {
    const selection = readyCandidates(
      findAdvisorCandidates(
        catalog([
          food(1, { cooking_method: "baked" }),
          food(2, { cooking_method: "extrusion" }),
          food(3, { cooking_method: "baked" }),
        ]),
        { ...baseQuery, cookingMethod: "baked" },
      ),
    );

    expect(selection.candidates.map((candidate) => candidate.food.id)).toEqual([
      3,
    ]);
    expect(selection.candidates[0]?.matchedReasons).toContain(
      "cooking_method_match",
    );
    expect(selection.excluded.cookingMethod).toBe(1);
  });

  it("requested kcal range excludes missing and out-of-range values separately", () => {
    const selection = readyCandidates(
      findAdvisorCandidates(
        catalog([
          food(1, { kcal_per_kg: 4000 }),
          food(2, { kcal_per_kg: null }),
          food(3, { kcal_per_kg: 4500 }),
          food(4, { kcal_per_kg: 4200 }),
        ]),
        { ...baseQuery, maxKcalDeltaPct: 10 },
      ),
    );

    expect(selection.candidates.map((candidate) => candidate.food.id)).toEqual([
      4,
    ]);
    expect(selection.candidates[0]?.kcalDeltaPct).toBe(5);
    expect(selection.excluded.kcalMissing).toBe(1);
    expect(selection.excluded.kcalOutsideRange).toBe(1);
  });

  it("without a kcal range, missing kcal remains eligible but sorts last", () => {
    const selection = readyCandidates(
      findAdvisorCandidates(
        catalog([
          food(1, { kcal_per_kg: 4000 }),
          food(2, { kcal_per_kg: null }),
          food(3, { kcal_per_kg: 4100 }),
        ]),
        baseQuery,
      ),
    );

    expect(selection.candidates.map((candidate) => candidate.food.id)).toEqual([
      3, 2,
    ]);
    expect(selection.candidates[1]?.unknowns).toContain("kcal_unknown");
  });

  it("declared carbohydrate accepts only a stated value with declared provenance", () => {
    const selection = readyCandidates(
      findAdvisorCandidates(
        catalog([
          food(1),
          food(2, {
            carb_pct: 20,
            nutrient_sources: { carb_pct: "manufacturer" },
          }),
          food(3, {
            carb_pct: 21,
            nutrient_sources: { carb_pct: "kr_label" },
          }),
          food(4, {
            carb_pct: 22,
            nutrient_sources: { carb_pct: "derived" },
          }),
          food(5, {
            carb_pct: 23,
            nutrient_sources: { carb_pct: "estimated" },
          }),
          food(6, { carb_pct: null, nutrient_sources: {} }),
          food(7, { carb_pct: 24, nutrient_sources: {} }),
        ]),
        { ...baseQuery, requireDeclaredCarb: true },
      ),
    );

    expect(selection.candidates.map((candidate) => candidate.food.id)).toEqual([
      2, 3,
    ]);
    expect(selection.excluded.declaredCarb).toBe(4);
    expect(selection.candidates[0]?.matchedReasons).toContain(
      "declared_carb_available",
    );
  });

  it("sorts only by absolute kcal delta and numeric ID, caps at three, and is repeatable", () => {
    const foods = [
      food(1, { kcal_per_kg: 4000 }),
      food(5, { kcal_per_kg: 3800 }),
      food(4, { kcal_per_kg: 4200 }),
      food(3, { kcal_per_kg: 3960 }),
      food(2, { kcal_per_kg: 4040 }),
    ];

    const first = readyCandidates(
      findAdvisorCandidates(catalog(foods), baseQuery),
    );
    const second = readyCandidates(
      findAdvisorCandidates(catalog(foods), baseQuery),
    );

    expect(first.candidates.map((candidate) => candidate.food.id)).toEqual([
      2, 3, 4,
    ]);
    expect(second.candidates.map((candidate) => candidate.food.id)).toEqual([
      2, 3, 4,
    ]);
  });

  it("keeps recall scope as a trade-off without changing ordering", () => {
    const productRecall = {
      affected_lots: null,
      brand_id: 2,
      classification: null,
      external_id: "product-recall",
      food_id: 2,
      id: 20,
      reason: "reason",
      recall_date: "2026-01-01",
      recalling_firm: "Brand 2",
      region: null,
      scope: "product" as const,
      source: "openfda",
      source_url: "https://example.test/recall",
    };
    const brandRecall = {
      ...productRecall,
      brand_id: 3,
      external_id: "brand-recall",
      food_id: null,
      id: 30,
      scope: "brand" as const,
    };
    const selection = readyCandidates(
      findAdvisorCandidates(
        catalog([
          food(1, { kcal_per_kg: 4000 }),
          food(3, { kcal_per_kg: 4040, recalls: [brandRecall] }),
          food(2, { kcal_per_kg: 4040, recalls: [productRecall] }),
        ]),
        baseQuery,
      ),
    );

    expect(selection.candidates.map((candidate) => candidate.food.id)).toEqual([
      2, 3,
    ]);
    expect(selection.candidates[0]?.tradeoffs).toEqual([
      "product_recall_history",
    ]);
    expect(selection.candidates[1]?.tradeoffs).toEqual([
      "brand_recall_history",
    ]);
  });

  it("exposes literal bounds while excluding derived carbohydrate from point comparison", () => {
    const evidenceByFoodId = new Map([
      [
        2,
        [
          evidence("protein_pct", 36, "Crude Protein (min.) 36%"),
          evidence("carb_pct", 23, "NFE 23%"),
        ],
      ],
      [3, [evidence("protein_pct", 35, "Protein 35%")]],
    ]);
    const selection = readyCandidates(
      findAdvisorCandidates(
        catalog(
          [
            food(1),
            food(2, {
              carb_pct: 23,
              nutrient_sources: {
                carb_pct: "derived",
                protein_pct: "manufacturer",
              },
            }),
            food(3, {
              nutrient_sources: { protein_pct: "manufacturer" },
            }),
          ],
          evidenceByFoodId,
        ),
        baseQuery,
      ),
    );

    expect(selection.candidates[0]?.evidence).toEqual(evidenceByFoodId.get(2));
    expect(selection.candidates[0]?.unknowns).toContain(
      "carb_point_comparison_unavailable",
    );
    expect(selection.candidates[0]?.unknowns).not.toContain(
      "protein_bound_unspecified",
    );
    expect(selection.candidates[1]?.unknowns).toContain(
      "protein_bound_unspecified",
    );
  });
});
