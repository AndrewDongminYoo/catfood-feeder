import { describe, expect, it } from "vitest";
import { ingredientDraftSchema, isIngredientRefusal } from "./source-apply";

const valid = {
  excerpt: "chicken, chicken meal, peas",
  ingredients: [
    { name: "chicken", position: 1 },
    { name: "chicken meal", position: 2 },
    { name: "peas", position: 3 },
  ],
  sourceId: 12,
};

describe("ingredientDraftSchema", () => {
  it("연속된 1..n 순서를 받는다", () => {
    expect(ingredientDraftSchema.safeParse(valid).success).toBe(true);
  });

  it("배열 순서와 어긋난 position 을 거절한다", () => {
    const swapped = {
      ...valid,
      ingredients: [
        { name: "chicken", position: 2 },
        { name: "chicken meal", position: 1 },
        { name: "peas", position: 3 },
      ],
    };

    expect(ingredientDraftSchema.safeParse(swapped).success).toBe(false);
  });

  it("1 이 아닌 곳에서 시작하는 순서를 거절한다", () => {
    const shifted = {
      ...valid,
      ingredients: [
        { name: "chicken", position: 2 },
        { name: "chicken meal", position: 3 },
        { name: "peas", position: 4 },
      ],
    };

    expect(ingredientDraftSchema.safeParse(shifted).success).toBe(false);
  });

  it("빈 목록을 거절한다", () => {
    expect(
      ingredientDraftSchema.safeParse({ ...valid, ingredients: [] }).success,
    ).toBe(false);
  });

  it("공백뿐인 구절을 거절한다", () => {
    expect(
      ingredientDraftSchema.safeParse({ ...valid, excerpt: "   " }).success,
    ).toBe(false);
  });

  it("빈 이름을 거절한다", () => {
    const blank = {
      ...valid,
      ingredients: [{ name: "  ", position: 1 }],
    };

    expect(ingredientDraftSchema.safeParse(blank).success).toBe(false);
  });

  it("긴 괄호형 premix 원재료를 보존한다", () => {
    const premix =
      "vitamins (vitamin E supplement, niacin supplement, d-calcium pantothenate, vitamin A supplement, thiamine mononitrate, riboflavin supplement, pyridoxine hydrochloride, biotin, vitamin B12 supplement, vitamin D3 supplement, folic acid)";

    const parsed = ingredientDraftSchema.safeParse({
      ...valid,
      excerpt: premix,
      ingredients: [{ name: premix, position: 1 }],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.excerpt).toBe(premix);
    expect(parsed.data.ingredients).toEqual([{ name: premix, position: 1 }]);
  });

  it("사라진 pct 와 type 을 조용히 받아 주지 않는다", () => {
    const legacy = {
      ...valid,
      ingredients: [{ name: "chicken", pct: 30, position: 1, type: "meat" }],
    };

    expect(ingredientDraftSchema.safeParse(legacy).success).toBe(false);
  });

  it("구절과 이름의 앞뒤 공백을 다듬는다", () => {
    const parsed = ingredientDraftSchema.safeParse({
      ...valid,
      excerpt: "  chicken, chicken meal, peas  ",
      ingredients: [{ name: "  chicken  ", position: 1 }],
    });

    expect(parsed.success && parsed.data.excerpt).toBe(
      "chicken, chicken meal, peas",
    );
    expect(parsed.success && parsed.data.ingredients[0].name).toBe("chicken");
  });
});

describe("isIngredientRefusal", () => {
  it("RPC 의 검증 거절을 SQLSTATE 로 알아본다", () => {
    // 문구로 가르면 규칙이 하나 늘 때마다 분류가 조용히 낡는다. 실제로 완전성
    // 검사를 추가하자마자 그 메시지가 목록에서 빠져 400 이어야 할 응답이 500 이 됐다.
    for (const message of [
      "Ingredient list does not cover the whole excerpt",
      "Ingredient name peas does not continue the excerpt at its declared position",
      "Ingredient positions must be 1..n in array order",
      "Evidence excerpt is absent from source 12",
      "Ingredients must be a non-empty JSON array",
    ]) {
      expect(isIngredientRefusal({ code: "CFING", message })).toBe(true);
    }
  });

  it("소유권 상실과 진짜 장애는 거절로 세지 않는다", () => {
    expect(
      isIngredientRefusal({ code: "CFCLM", message: "Research claim lost" }),
    ).toBe(false);
    expect(
      isIngredientRefusal({ code: "57014", message: "canceling statement" }),
    ).toBe(false);
    expect(isIngredientRefusal(new Error("connection reset"))).toBe(false);
    expect(isIngredientRefusal(null)).toBe(false);
  });
});
