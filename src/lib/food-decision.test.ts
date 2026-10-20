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
  it.each([
    ["chickenmeal", "chicken"],
    ["chickenfat", "chicken"],
    ["chickenoil", "chicken"],
    ["turkeymeal", "turkey"],
    ["turkeyfat", "turkey"],
    ["duckmeal", "duck"],
    ["duckfat", "duck"],
    ["beefmeal", "beef"],
    ["beeffat", "beef"],
    ["bovinemeal", "beef"],
    ["lambmeal", "lamb"],
    ["lambfat", "lamb"],
    ["muttonmeal", "lamb"],
    ["fishmeal", "fish"],
    ["WHITEFISHMEAL", "fish"],
    ["fishoil", "fish"],
    ["cornmeal", "grain"],
    ["oatmeal", "grain"],
    ["oatflour", "grain"],
    ["wheatbran", "grain"],
    ["통밀", "grain"],
    ["통밀가루", "grain"],
    ["밀기울", "grain"],
    ["밀배아", "grain"],
  ] as const)("rejects the compact derivative %s", (name, exclusion) => {
    expect(
      assessIngredientExclusion([{ name, position: 1 }], exclusion, true)
        .status,
    ).toBe("failed");
    const input = catalog();
    input.foods[1]!.ingredients = [{ name, position: 1 }];
    input.ingredientEvidenceByFoodId[2]!.excerpt = name;
    const report = buildFoodDecision(input, {
      ...request,
      exclusions: [exclusion],
    });
    expect(report.eligible.some((candidate) => candidate.food.id === 2)).toBe(
      false,
    );
    expect(
      report.excluded
        .find((candidate) => candidate.food.id === 2)
        ?.conditions.find((condition) => condition.key === exclusion)?.status,
    ).toBe("failed");
  });
  it.each([
    ["cornflower", "grain"],
    ["ryegrass", "grain"],
    ["fishmint", "fish"],
    ["밀크씨슬", "grain"],
    ["밀웜", "grain"],
  ] as const)("retains word boundaries for %s", (name, exclusion) => {
    expect(
      assessIngredientExclusion([{ name, position: 1 }], exclusion, true)
        .status,
    ).toBe("met");
  });
  it.each([
    ["밀", "grain", "failed"],
    ["flounder", "fish", "failed"],
    ["hydrolyzed liver", "chicken", "unknown"],
    ["blood meal", "chicken", "unknown"],
  ] as const)("classifies %s conservatively", (name, exclusion, expected) => {
    expect(
      assessIngredientExclusion([{ name, position: 1 }], exclusion, true)
        .status,
    ).toBe(expected);
  });
  it.each(["cereals", "곡물", "곡류", "unidentified grain protein"])(
    "rejects the declared grain family %s",
    (name) => {
      expect(
        assessIngredientExclusion([{ name, position: 1 }], "grain", true)
          .status,
      ).toBe("failed");
    },
  );
  it.each([
    "starch",
    "flour",
    "Modified Starch",
    "food starch",
    "vegetable starch",
    "buckwheat flour",
    "전분",
    "변성전분",
    "녹말",
    "가루",
    "starch (chicken flavour)",
    "starch (pea protein)",
    "pea starch and modified starch",
    "potato starch (modified starch)",
  ])("keeps the grain origin of %s unknown with complete proof", (name) => {
    const result = assessIngredientExclusion(
      [
        { name: "Salmon", position: 1 },
        { name, position: 2 },
      ],
      "grain",
      true,
    );
    expect(result.status).toBe("unknown");
    expect(result.detail).toContain(name);
  });
  it.each([
    "wheat starch",
    "corn flour",
    "cornstarch",
    "rice flour",
    "옥수수전분",
    "밀전분",
    "쌀가루",
  ])("rejects the grain-derived starch or flour %s", (name) => {
    expect(
      assessIngredientExclusion([{ name, position: 1 }], "grain", true).status,
    ).toBe("failed");
  });
  it.each([
    "potato starch",
    "pea starch",
    "tapioca starch",
    "pea flour",
    "chickpea flour",
    "sweet potato flour",
    "flaxseed flour",
    "fish flour",
    "감자전분",
    "타피오카 전분",
    "modified starch (tapioca)",
    "전분(감자)",
    "토마토가루",
    "효모가루",
    "닭고기가루",
  ])("accepts the named non-grain starch or flour %s", (name) => {
    expect(
      assessIngredientExclusion([{ name, position: 1 }], "grain", true).status,
    ).toBe("met");
  });
  it("separates a missing ingredient source from an unknown starch origin", () => {
    const missing = assessIngredientExclusion(
      [{ name: "potato starch", position: 1 }],
      "grain",
      false,
    );
    const ambiguous = assessIngredientExclusion(
      [{ name: "starch", position: 1 }],
      "grain",
      true,
    );
    expect(missing.status).toBe("unknown");
    expect(missing.detail).not.toContain("potato starch");
    expect(ambiguous.status).toBe("unknown");
    expect(ambiguous.detail).not.toBe(missing.detail);
    const unverified = assessIngredientExclusion(
      [{ name: "starch", position: 1 }],
      "grain",
      false,
    );
    expect(unverified.status).toBe("unknown");
    expect(unverified.detail).toBe(missing.detail);
  });
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
  it("never substitutes a stale manual baseline for a missing selected catalog food", () => {
    const input = catalog();
    input.foods = input.foods.filter((candidate) => candidate.id !== 1);
    const values = {
      ...request,
      manualCurrentName: "Old manual food",
      manualKcal: 3500,
    };
    const report = buildFoodDecision(input, values);
    expect(report.status).toBe("baseline_missing");
    expect(report.baseline.origin).toBe("unknown");
    expect(report.baseline.kcal).toBeNull();
    expect(report.baseline.name).not.toContain("Old manual food");
    expect(report.eligible).toHaveLength(0);
    const manual = buildFoodDecision(input, { ...values, currentFoodId: null });
    expect(manual.baseline).toMatchObject({
      name: "Old manual food",
      kcal: 3500,
      origin: "owner",
    });
    expect(manual.status).toBe("ready");
  });
  it.each([
    ["fishoil", "fish"],
    ["salmonoil", "fish"],
    ["Fish oil", "fish"],
    ["Salmon oil", "fish"],
    ["chickenfat", "chicken"],
    ["turkeyfat", "turkey"],
    ["duckfat", "duck"],
    ["beeffat", "beef"],
    ["lambfat", "lamb"],
  ] as const)(
    "excludes %s but skips it when assessing the first protein preference",
    (name, exclusion) => {
      const input = catalog();
      input.foods[1]!.ingredients = [
        { name, position: 1 },
        { name: "Chicken meal", position: 2 },
      ];
      input.ingredientEvidenceByFoodId[2]!.excerpt = `${name}, Chicken meal`;
      expect(
        assessIngredientExclusion(input.foods[1]!.ingredients, exclusion, true)
          .status,
      ).toBe("failed");
      for (const preferred of ["fish", "chicken"] as const) {
        const report = buildFoodDecision(input, {
          ...request,
          exclusions: [],
          preferredProteins: [preferred],
        });
        const preference = report.eligible.find(
          (candidate) => candidate.food.id === 2,
        )!.preference;
        expect(preference.status).toBe(
          preferred === "fish" ? "other" : "preferred",
        );
        expect(preference.detail).toContain("2번째 “Chicken meal”");
      }
    },
  );
  it.each(["poultrymeal", "poultryfat", "animalmeal", "animalfat", "meatmeal"])(
    "leaves the species of compact broad derivative %s unknown",
    (name) => {
      expect(
        assessIngredientExclusion([{ name, position: 1 }], "chicken", true)
          .status,
      ).toBe("unknown");
    },
  );
  it.each([
    "Kangaroo meal",
    "Marine protein",
    "캥거루육분",
    "Kangaroo meal with peas",
  ])(
    "does not skip unclassified leading animal ingredient %s to claim a preference",
    (name) => {
      const input = catalog();
      input.foods[1]!.ingredients = [
        { name, position: 1 },
        { name: "Chicken meal", position: 2 },
      ];
      input.ingredientEvidenceByFoodId[2]!.excerpt = `${name}, Chicken meal`;
      const report = buildFoodDecision(input, {
        ...request,
        exclusions: [],
        preferredProteins: ["chicken"],
      });
      expect(
        report.eligible.find((c) => c.food.id === 2)!.preference.status,
      ).toBe("unknown");
    },
  );
  it.each(["Chicken meat and fat", "Chicken liver (with chicken broth)"])(
    "retains the animal part of compound ingredient %s for preferences",
    (name) => {
      const input = catalog();
      input.foods[1]!.ingredients = [
        { name, position: 1 },
        { name: "Salmon meal", position: 2 },
      ];
      input.ingredientEvidenceByFoodId[2]!.excerpt = `${name}, Salmon meal`;
      const preference = (preferredProteins: ("chicken" | "fish")[]) =>
        buildFoodDecision(input, {
          ...request,
          exclusions: [],
          preferredProteins,
        }).eligible.find((c) => c.food.id === 2)!.preference;
      expect(preference(["chicken"]).status).toBe("preferred");
      expect(preference(["chicken"]).detail).toContain(`1번째 “${name}”`);
      expect(preference(["fish"]).status).toBe("other");
    },
  );
  it.each([
    ["Chicken fat", "chicken"],
    ["Fresh chicken fat", "chicken"],
    ["Raw chicken fat", "chicken"],
    ["Whole chicken fat", "chicken"],
    ["우지", "beef"],
    ["Beef tallow", "beef"],
  ] as const)(
    "does not prioritize %s as a protein preference",
    (fat, preference) => {
      const input = catalog();
      input.foods[1]!.ingredients = [
        { name: fat, position: 1 },
        { name: "Salmon meal", position: 2 },
      ];
      input.ingredientEvidenceByFoodId[2]!.excerpt = `${fat}, Salmon meal`;
      const report = buildFoodDecision(input, {
        ...request,
        exclusions: [],
        preferredProteins: [preference],
      });
      expect(
        report.eligible.find((c) => c.food.id === 2)?.preference.status,
      ).toBe("other");
    },
  );
  it.each(["Goose meal", "Quail", "거위 고기"])(
    "recognizes %s as poultry without claiming a specific preferred bird",
    (name) => {
      const input = catalog();
      input.foods[1]!.ingredients = [{ name, position: 1 }];
      input.ingredientEvidenceByFoodId[2]!.excerpt = name;
      const result = (preferredProteins: ("poultry" | "chicken")[]) =>
        buildFoodDecision(input, {
          ...request,
          exclusions: [],
          preferredProteins,
        }).eligible.find((c) => c.food.id === 2)!.preference.status;
      expect(result(["poultry"])).toBe("preferred");
      expect(result(["chicken"])).toBe("other");
    },
  );
  it("prioritizes an evidenced preference without excluding other matching foods", () => {
    const input = catalog();
    input.foods[2]!.kcal_per_kg = 4200;
    input.evidenceByFoodId.set(3, [evidence(4200)]);
    input.foods[2]!.ingredients = [
      { name: "Chicken meal", position: 1 },
      { name: "peas", position: 2 },
    ];
    input.ingredientEvidenceByFoodId[3]!.excerpt = "Chicken meal, peas";
    const report = buildFoodDecision(input, {
      ...request,
      exclusions: [],
      preferredProteins: ["poultry"],
    });
    expect(report.eligible.map((c) => c.food.id)).toEqual([4, 3, 2]);
    expect(
      report.eligible.find((c) => c.food.id === 3)?.preference,
    ).toMatchObject({
      status: "preferred",
      detail: expect.stringContaining("Chicken meal"),
    });
    expect(
      report.eligible.find((c) => c.food.id === 2)?.preference?.status,
    ).toBe("other");
    expect(report.excluded).toHaveLength(0);
  });
  it("keeps a preference unknown when the complete ingredient proof is missing", () => {
    const input = catalog();
    delete input.ingredientEvidenceByFoodId[2];
    const report = buildFoodDecision(input, {
      ...request,
      exclusions: [],
      preferredProteins: ["fish"],
    });
    expect(
      report.eligible.find((c) => c.food.id === 2)?.preference?.status,
    ).toBe("unknown");
  });
  it("never lets a preferred ingredient override a hard exclusion", () => {
    const input = catalog();
    input.foods[1]!.ingredients = [{ name: "Chicken", position: 1 }];
    input.ingredientEvidenceByFoodId[2]!.excerpt = "Chicken";
    const report = buildFoodDecision(input, {
      ...request,
      preferredProteins: ["chicken"],
    });
    expect(report.excluded.map((c) => c.food.id)).toContain(2);
  });
  it("keeps poultry label order unknown when an earlier animal organ has no named species", () => {
    const input = catalog();
    input.foods[1]!.ingredients = [
      { name: "hydrolyzed liver", position: 1 },
      { name: "Chicken", position: 2 },
      { name: "Salmon", position: 3 },
    ];
    input.ingredientEvidenceByFoodId[2]!.excerpt =
      "hydrolyzed liver, Chicken, Salmon";
    const report = buildFoodDecision(input, {
      ...request,
      exclusions: [],
      poultryFirst: true,
    });
    expect(report.unresolved.map((c) => c.food.id)).toContain(2);
  });
  it("does not call an empty set of conditions a successful comparison", () => {
    expect(
      buildFoodDecision(catalog(), {
        ...request,
        exclusions: [],
        maxKcalDeltaPct: null,
      }).status,
    ).toBe("conditions_missing");
  });
  it("keeps unconfirmed qualitative conditions unresolved", () => {
    const result = buildFoodDecision(catalog(), {
      ...request,
      pendingClarifications: ["calories"],
    });
    expect(result.eligible).toHaveLength(0);
    expect(
      result.unresolved[0]?.conditions.some(
        (c) => c.key === "clarify-calories",
      ),
    ).toBe(true);
  });
  it("uses the exact eight-percent limit and a separately confirmed calorie ceiling", () => {
    const input = catalog();
    input.foods[1]!.kcal_per_kg = 4360;
    input.evidenceByFoodId.set(2, [evidence(4360)]);
    expect(
      buildFoodDecision(input, { ...request, maxKcalDeltaPct: 8 }).eligible,
    ).toHaveLength(0);
    expect(
      buildFoodDecision(catalog(), { ...request, notHigherKcal: true })
        .eligible,
    ).toHaveLength(0);
  });
  it("compares confirmed poultry-first label order without predicting taste", () => {
    const input = catalog();
    input.foods[1]!.ingredients = [
      { name: "Chicken", position: 1 },
      { name: "Salmon", position: 2 },
    ];
    input.ingredientEvidenceByFoodId[2]!.excerpt = "Chicken, Salmon";
    input.foods[3]!.ingredients = [
      { name: "animal meal", position: 1 },
      { name: "peas", position: 2 },
    ];
    input.ingredientEvidenceByFoodId[4]!.excerpt = "animal meal, peas";
    const result = buildFoodDecision(input, {
      ...request,
      exclusions: [],
      poultryFirst: true,
    });
    expect(result.eligible.map((c) => c.food.id)).toEqual([2]);
    expect(
      result.eligible[0]?.conditions.find((c) => c.key === "poultry-first")
        ?.detail,
    ).toContain("Chicken");
    expect(result.excluded.map((c) => c.food.id)).toContain(3);
  });
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
    "8주령 고양이에게 먹일 사료",
    "CKD 고양이 사료 추천",
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
  it("exports the calorie evidence for both sides of the comparison", () => {
    const input = catalog();
    input.evidenceByFoodId.get(1)![0]!.source.url =
      "https://manufacturer.test/baseline";
    const text = exportDecisionBrief({
      version: 1,
      report: buildFoodDecision(input, request),
      selectedFoodId: null,
      reason: "",
    });
    expect(text).toContain("https://manufacturer.test/baseline");
    expect(text).toContain("4000 kcal/kg");
    expect(text).toContain("2026-10-01T00:00:00Z");
  });
  it("does not offer kitten or explicitly therapeutic products to an adult non-prescription request", () => {
    const input = catalog();
    input.foods[1]!.product_name = "Recipe Kitten";
    expect(buildFoodDecision(input, request).eligible).toHaveLength(0);
  });
  it.each([
    "Diabetic",
    "Kidney Care",
    "Mother & Babycat",
    "Urinary",
    "Intestinal",
    "Hepatic",
    "Cardiac",
    "Liver Care",
    "Heart Disease Diet",
    "Thyroid Diet",
    "heart-support",
    "신장 관리",
  ])(
    "excludes clinical or life-stage product wording in the full identity: %s",
    (name) => {
      for (const field of ["product", "brand"] as const) {
        const input = catalog();
        const target = input.foods[1]!;
        target.product_name = field === "product" ? name : "Adult recipe";
        target.brands = {
          ...target.brands!,
          name: field === "brand" ? name : "Ordinary brand",
        };
        const report = buildFoodDecision(input, { ...request, exclusions: [] });
        expect(
          report.eligible.some((candidate) => candidate.food.id === 2),
        ).toBe(false);
        expect(
          report.unresolved.some((candidate) => candidate.food.id === 2),
        ).toBe(false);
      }
    },
  );
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
  it.each(["Chicken Liver Recipe", "Chicken Heart & Liver"])(
    "retains ordinary organ ingredients in candidate identity: %s",
    (name) => {
      const input = catalog();
      input.foods[1]!.product_name = name;
      expect(
        buildFoodDecision(input, request).eligible.map((c) => c.food.id),
      ).toContain(2);
    },
  );
  it.each([{ otherPending: [] }, { otherPending: ["poultry"] }] as const)(
    "counts sensitivity candidates after confirming only calories (%j)",
    ({ otherPending }) => {
      const input = catalog();
      const pending = buildFoodDecision(input, {
        ...request,
        pendingClarifications: ["calories", ...otherPending],
      });
      expect(pending.eligible).toHaveLength(0);
      for (const sensitivity of pending.sensitivity) {
        const confirmed = buildFoodDecision(input, {
          ...request,
          pendingClarifications: [...otherPending],
          maxKcalDeltaPct: sensitivity.maxKcalDeltaPct,
        });
        expect(sensitivity.eligibleCount).toBe(confirmed.eligible.length);
        expect(sensitivity.eligibleCount).toBe(otherPending.length ? 0 : 1);
      }
    },
  );
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
  it.each([
    "urinary diet",
    "URINARY food",
    "intestinal diet",
    "hepatic diet",
    "cardiac diet",
    "liver disease diet",
    "heart disease diet",
    "thyroid diet",
    "Liver Care",
    "heart-support",
    "hyperthyroidism",
    "유리너리 사료",
    "인테스티널 사료",
    "레날 사료",
  ])(
    "stops clinical requests without relying on interpretation: %s",
    (question) => {
      const result = buildFoodDecision(catalog(), {
        ...request,
        question,
        adultNonPrescription: true,
        unresolvedRequirements: [],
        ignoredRequirements: [question],
      });
      expect(result.status).toBe("outside_scope");
      expect(result.eligible).toHaveLength(0);
      expect(result.unresolved).toHaveLength(0);
    },
  );
  it("keeps a candidate with an unknown starch origin unresolved through save and export", () => {
    const input = catalog();
    input.foods[1]!.ingredients = [
      { name: "Salmon", position: 1 },
      { name: "starch", position: 2 },
    ];
    input.ingredientEvidenceByFoodId[2]!.excerpt = "Salmon, starch";
    input.foods[3]!.ingredients = [
      { name: "Salmon", position: 1 },
      { name: "potato starch", position: 2 },
    ];
    input.ingredientEvidenceByFoodId[4]!.excerpt = "Salmon, potato starch";
    const result = buildFoodDecision(input, {
      ...request,
      exclusions: ["grain"],
    });
    expect(result.eligible.map((c) => c.food.id)).toEqual([4]);
    const ambiguous = result.unresolved.find((c) => c.food.id === 2);
    expect(ambiguous?.ingredientEvidence?.excerpt).toBe("Salmon, starch");
    expect(ambiguous?.kcalDeltaPct).toBeCloseTo(5);
    expect(ambiguous?.conditions.find((c) => c.key === "grain")?.status).toBe(
      "unknown",
    );
    const saved = decisionSnapshotSchema.parse(
      JSON.parse(
        JSON.stringify({
          version: 1,
          report: result,
          selectedFoodId: 2,
          reason: "전분 유래를 확인하려고 보류",
        }),
      ),
    );
    expect(saved.report.eligible.some((c) => c.food.id === 2)).toBe(false);
    expect(
      saved.report.unresolved
        .find((c) => c.food.id === 2)
        ?.conditions.find((c) => c.key === "grain")?.status,
    ).toBe("unknown");
    const brief = exportDecisionBrief(saved);
    const start = brief.indexOf(`## ${ambiguous!.food.brand} Recipe 2`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = brief.indexOf("\n## ", start + 1);
    const section = brief.slice(start, end < 0 ? undefined : end);
    expect(section).toMatch(/곡물 표기 제외: 확인 필요 — .*starch/);
    expect(section).not.toMatch(/곡물 표기 제외: 표기 기준 충족/);
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
