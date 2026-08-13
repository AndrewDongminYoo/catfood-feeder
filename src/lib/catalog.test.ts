import { describe, expect, it } from "vitest";
import {
  attachRecallScopes,
  classifyRecallScope,
  loadPublicFoods,
  orderComparisonFoods,
} from "./catalog";
import { SAMPLE_FOODS } from "./fixtures";

const [foodA] = SAMPLE_FOODS;
const foodB = { ...foodA, id: 1, product_name: "Second Recipe" };
const unselectedFood = { ...foodA, id: 2, product_name: "Unselected Recipe" };

describe("orderComparisonFoods", () => {
  it("선택한 id 순서대로 비교 대상을 반환한다", () => {
    expect(orderComparisonFoods([foodA, foodB], [foodB.id, foodA.id])).toEqual([
      foodB,
      foodA,
    ]);
  });

  it("중복되거나 존재하지 않는 id로 다른 제품을 보충하지 않는다", () => {
    expect(
      orderComparisonFoods(
        [foodA, foodB, unselectedFood],
        [foodB.id, foodB.id, 999],
      ),
    ).toEqual([foodB]);
  });
});

describe("attachRecallScopes", () => {
  it("제품 이력과 브랜드 범위 이력을 구분하고 다른 브랜드 이력은 제외한다", () => {
    const productRecall = {
      affected_lots: "PRODUCT-LOT",
      brand_id: foodA.brand_id,
      classification: "Class II",
      external_id: "product-recall",
      food_id: foodA.id,
      id: 101,
      reason: "Product-specific issue",
      recall_date: "2026-08-12",
      recalling_firm: "Example Firm",
      region: "US",
      source: "openFDA Food Enforcement",
      source_url: "https://example.test/recalls/product",
    };
    const brandRecall = {
      ...productRecall,
      affected_lots: "BRAND-LOT",
      external_id: "brand-recall",
      food_id: null,
      id: 102,
      reason: "Brand-scoped issue",
      source_url: "https://example.test/recalls/brand",
    };

    const [merged] = attachRecallScopes(
      [{ ...foodA, recalls: [productRecall] }],
      [brandRecall, { ...brandRecall, brand_id: 999, id: 103 }],
    );

    expect(merged.recalls).toEqual([
      { ...productRecall, scope: "product" },
      { ...brandRecall, scope: "brand" },
    ]);
  });
});

describe("classifyRecallScope", () => {
  it("제품, 브랜드, 카탈로그 미연결 이력을 FK 상태로 구분한다", () => {
    expect(classifyRecallScope({ brand_id: 1, food_id: 2 })).toBe("product");
    expect(classifyRecallScope({ brand_id: 1, food_id: null })).toBe("brand");
    expect(classifyRecallScope({ brand_id: null, food_id: null })).toBe(
      "unlinked",
    );
  });
});

describe("loadPublicFoods", () => {
  it("발행됐지만 단백질이 비어 있는 제품도 공개 결과에 남긴다", async () => {
    let foodRows = [{ ...foodA, protein_pct: null }];
    const foodQuery = {
      select: () => foodQuery,
      not: (column: string) => {
        if (column === "protein_pct") foodRows = [];
        return foodQuery;
      },
      order: async () => ({ data: foodRows, error: null }),
    };
    const recallQuery = {
      select: () => recallQuery,
      is: () => recallQuery,
      in: () => recallQuery,
      order: async () => ({ data: [], error: null }),
    };
    const client = {
      from: (table: string) => (table === "foods" ? foodQuery : recallQuery),
    };

    const foods = await loadPublicFoods(client as never);

    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({ id: foodA.id, protein_pct: null });
  });
});
