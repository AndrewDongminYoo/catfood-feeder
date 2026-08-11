// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_FOODS } from "@/lib/fixtures";
import { FoodComparison } from "./food-comparison";

const [acana] = SAMPLE_FOODS;
const secondFood = {
  ...acana,
  brand_id: 1,
  brands: { ...acana.brands!, id: 1, name: "Second Brand" },
  id: 1,
  product_name: "Second Recipe",
};

afterEach(cleanup);

describe("FoodComparison", () => {
  it("선택 순서의 두 제품 지표와 근거 상태를 승패 없이 병렬로 보여준다", () => {
    render(<FoodComparison foods={[secondFood, acana]} />);

    const productHeadings = screen.getAllByRole("heading", { level: 3 });
    expect(
      productHeadings.slice(0, 2).map((heading) => heading.textContent),
    ).toEqual([secondFood.product_name, acana.product_name]);
    expect(screen.getAllByText("단백질")).toHaveLength(2);
    expect(screen.getAllByText("계산값").length).toBeGreaterThan(0);
    expect(screen.getByText("차이를 확인하세요")).toBeTruthy();
    expect(
      screen.getAllByText(/국내 리콜 이력이 없다는 뜻은 아닙니다/),
    ).toHaveLength(2);
    expect(screen.queryByText(/추천|승자|더 좋은/)).toBeNull();
  });

  it("두 제품이 아니면 카탈로그에서 선택하도록 안내한다", () => {
    render(<FoodComparison foods={[acana]} />);

    expect(screen.getByText(/두 제품을 선택하세요/)).toBeTruthy();
  });

  it("각 제품의 리콜 근거를 건수로만 축약하지 않는다", () => {
    render(
      <FoodComparison
        foods={[
          {
            ...acana,
            recalls: [
              {
                affected_lots: "LOT-142",
                brand_id: acana.brand_id,
                classification: "Class II",
                external_id: null,
                food_id: acana.id,
                id: 142,
                reason: "Labeling issue",
                recall_date: "2026-08-11",
                recalling_firm: "Example Firm",
                region: "US",
                source: "openFDA Food Enforcement",
                source_url: "https://example.test/recall/142",
              },
            ],
          },
          secondFood,
        ]}
      />,
    );

    expect(screen.getByText("출처: openFDA Food Enforcement")).toBeTruthy();
    expect(screen.getByText("대상 로트: LOT-142")).toBeTruthy();
  });
});
