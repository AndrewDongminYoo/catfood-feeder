import { describe, expect, it } from "vitest";
import { SAMPLE_FOODS } from "./fixtures";
import type { FoodWithBrand, NutrientEvidence } from "./catalog";
import {
  assessIngredientExclusion,
  buildFoodDecision,
  decisionSnapshotSchema,
  exportDecisionBrief,
  type DecisionRequest,
} from "./food-decision";

const food = (
  id: number,
  kcal: number | null,
  names = ["Salmon", "peas"],
): FoodWithBrand => ({
  ...SAMPLE_FOODS[0]!,
  id,
  product_name: `Recipe ${id}`,
  kcal_per_kg: kcal,
  ingredients: names.map((name, i) => ({ name, position: i + 1 })),
});
const evidence = (value: number): NutrientEvidence => ({
  nutrient_key: "kcal_per_kg",
  value,
  excerpt: `${value} kcal/kg`,
  captured_at: "2026-10-01T00:00:00Z",
  source: { url: "https://manufacturer.test/recipe", capture_method: "fetch" },
});
const request: DecisionRequest = {
  question: "다음 사료는 닭고기 표기를 빼고 열량은 비슷하게 고르고 싶어요",
  catName: "모카",
  currentFoodId: 1,
  manualCurrentName: "",
  manualKcal: null,
  exclusions: ["chicken"],
  maxKcalDeltaPct: 10,
  adultNonPrescription: true,
};
function catalog() {
  return {
    foods: [
      food(1, 4000),
      food(2, 4200),
      food(3, 4800),
      food(4, 4100, ["poultry meal", "peas"]),
    ],
    evidenceByFoodId: new Map(
      [1, 2, 3, 4].map((id) => [
        id,
        [evidence([0, 4000, 4200, 4800, 4100][id]!)],
      ]),
    ),
    ingredientEvidenceByFoodId: Object.fromEntries(
      [1, 2, 3, 4].map((id) => [
        id,
        {
          excerpt: id === 4 ? "poultry meal, peas" : "Salmon, peas",
          capturedAt: "2026-10-01T00:00:00Z",
          url: "https://manufacturer.test/ingredients",
        },
      ]),
    ),
  };
}

describe("ingredient exclusion", () => {
  it.each(["cereals", "곡물", "곡류", "unidentified grain protein"])(
    "rejects the declared grain family %s",
    (name) => {
      expect(
        assessIngredientExclusion([{ name, position: 1 }], "grain", true)
          .status,
      ).toBe("failed");
    },
  );
  it("leaves unsourced hydrolyzed protein unknown", () => {
    expect(
      assessIngredientExclusion(
        [{ name: "hydrolyzed protein", position: 1 }],
        "chicken",
        true,
      ).status,
    ).toBe("unknown");
  });
  it.each(["Chicken fat", "계육분", "닭간", "hydrolyzed chicken protein"])(
    "flags the declared derivative %s",
    (name) => {
      expect(
        assessIngredientExclusion([{ name, position: 1 }], "chicken", true)
          .status,
      ).toBe("failed");
    },
  );
  it("keeps generic poultry and missing evidence unknown", () => {
    expect(
      assessIngredientExclusion(
        [{ name: "poultry meal", position: 1 }],
        "chicken",
        true,
      ).status,
    ).toBe("unknown");
    expect(
      assessIngredientExclusion(
        [{ name: "Salmon", position: 1 }],
        "chicken",
        false,
      ).status,
    ).toBe("unknown");
    expect(assessIngredientExclusion([], "chicken", true).status).toBe(
      "unknown",
    );
  });
  it("does not confuse a chemical ingredient with beef or a named unrelated bird with chicken", () => {
    expect(
      assessIngredientExclusion(
        [{ name: "taurine", position: 1 }],
        "beef",
        true,
      ).status,
    ).toBe("met");
    expect(
      assessIngredientExclusion(
        [{ name: "Duck", position: 1 }],
        "chicken",
        true,
      ).status,
    ).toBe("met");
  });
});

describe("food decision", () => {
  it("preserves each side's literal nutrient bounds and supporting quote in the brief", () => {
    const input = catalog();
    input.foods[1]!.protein_pct = 32;
    input.evidenceByFoodId.get(1)!.push({
      ...evidence(36),
      nutrient_key: "protein_pct",
      excerpt: "Crude protein min. 36%",
    });
    input.evidenceByFoodId.get(2)!.push({
      ...evidence(32),
      nutrient_key: "protein_pct",
      excerpt: "Crude protein min. 32%",
    });
    const result = buildFoodDecision(input, request);
    expect(result.baseline.labelFacts[0]).toMatchObject({
      key: "protein_pct",
      value: 36,
      bound: "minimum",
      proof: { excerpt: "Crude protein min. 36%" },
    });
    expect(result.eligible[0]!.labelFacts[0]).toMatchObject({
      key: "protein_pct",
      value: 32,
      bound: "minimum",
    });
  });
  it.each([
    "새끼 고양이에게 먹일 사료",
    "생후 3개월 고양이 사료",
    "심장병 고양이에게 먹일 사료",
  ])("blocks the conflicting question %s", (question) => {
    expect(buildFoodDecision(catalog(), { ...request, question }).status).toBe(
      "outside_scope",
    );
  });
  it("preserves unsupported requirements as unresolved conditions", () => {
    const result = buildFoodDecision(catalog(), {
      ...request,
      unresolvedRequirements: ["완두콩 제외 여부를 확인하지 못했습니다."],
    });
    expect(result.eligible).toHaveLength(0);
    expect(
      result.unresolved[0]?.conditions.some(
        (c) => c.status === "unknown" && c.detail.includes("완두콩"),
      ),
    ).toBe(true);
  });
  it("exports the conditions and failed candidates even when none qualify", () => {
    const result = buildFoodDecision(catalog(), {
      ...request,
      maxKcalDeltaPct: 5,
    });
    const text = exportDecisionBrief({
      version: 1,
      report: result,
      selectedFoodId: null,
      reason: "조건 불충족",
    });
    expect(text).toContain("Recipe 3");
    expect(text).toContain("열량 차이 5% 이내");
    expect(text).toContain("조건 불충족");
  });
  it("does not offer kitten or explicitly therapeutic products to an adult non-prescription request", () => {
    const input = catalog();
    input.foods[1]!.product_name = "Recipe Kitten";
    expect(buildFoodDecision(input, request).eligible).toHaveLength(0);
  });
  it("separates eligible, failed, and unresolved candidates without silently relaxing conditions", () => {
    const result = buildFoodDecision(
      catalog(),
      request,
      "2026-10-18T12:00:00Z",
    );
    expect(result.eligible.map((c) => c.food.id)).toEqual([2]);
    expect(result.unresolved.map((c) => c.food.id)).toEqual([4]);
    expect(result.excluded.map((c) => c.food.id)).toEqual([3]);
    expect(result.eligible[0]!.kcalDeltaPct).toBe(5);
    expect(
      result.sensitivity.find((s) => s.maxKcalDeltaPct === 5)?.eligibleCount,
    ).toBe(1);
  });
  it("does not use a mismatching quote to justify a calorie comparison", () => {
    const input = catalog();
    input.evidenceByFoodId.set(2, [evidence(3999)]);
    const result = buildFoodDecision(input, request);
    expect(result.eligible).toHaveLength(0);
    expect(
      result.unresolved.find((c) => c.food.id === 2)?.questions.join(" "),
    ).toContain("열량");
  });
  it("requires matching complete ingredient evidence before asserting label absence", () => {
    const input = catalog();
    input.ingredientEvidenceByFoodId[2]!.excerpt = "Salmon";
    expect(
      buildFoodDecision(input, request).unresolved.map((c) => c.food.id),
    ).toContain(2);
  });
  it("supports an explicitly owner-entered baseline without converting it into a manufacturer fact", () => {
    const result = buildFoodDecision(catalog(), {
      ...request,
      currentFoodId: null,
      manualCurrentName: "집에 있는 사료",
      manualKcal: 4000,
    });
    expect(result.baseline.origin).toBe("owner");
    expect(result.eligible.map((c) => c.food.id)).toContain(2);
    expect(result.baseline.evidence).toBeNull();
  });
  it("blocks unsupported clinical or life-stage requests instead of suggesting products", () => {
    const result = buildFoodDecision(catalog(), {
      ...request,
      question: "신장병 처방식 대신 먹일 사료",
      adultNonPrescription: true,
    });
    expect(result.status).toBe("outside_scope");
    expect(result.eligible).toHaveLength(0);
    expect(
      buildFoodDecision(catalog(), { ...request, adultNonPrescription: false })
        .status,
    ).toBe("outside_scope");
  });
  it("keeps saved evidence and results independent from subsequent catalog mutation", () => {
    const input = catalog();
    const result = buildFoodDecision(input, request);
    const saved = decisionSnapshotSchema.parse({
      version: 1,
      report: result,
      selectedFoodId: 2,
      reason: "열량 차이가 작아서",
    });
    input.foods[1]!.kcal_per_kg = 4900;
    expect(saved.report.eligible[0]!.food.kcal_per_kg).toBe(4200);
    expect(exportDecisionBrief(saved)).toContain("열량 차이가 작아서");
    expect(exportDecisionBrief(saved)).toContain(
      "https://manufacturer.test/recipe",
    );
    expect(decisionSnapshotSchema.safeParse({ version: 999 }).success).toBe(
      false,
    );
  });
});
