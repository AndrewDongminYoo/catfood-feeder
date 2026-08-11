import { describe, expect, it } from "vitest";
import { orderComparisonFoods } from "./catalog";
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
