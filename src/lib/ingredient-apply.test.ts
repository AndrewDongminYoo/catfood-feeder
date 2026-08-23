import { describe, expect, it } from "vitest";
import { ingredientDraftSchema } from "./source-apply";

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
