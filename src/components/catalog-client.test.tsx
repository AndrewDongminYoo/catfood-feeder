// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_FOODS } from "@/lib/fixtures";
import { CatalogClient } from "./catalog-client";

const [acana] = SAMPLE_FOODS;
const otherFood = {
  ...acana,
  brand_id: 1,
  brands: { ...acana.brands!, id: 1, name: "Other Brand" },
  id: 1,
  product_name: "Other Recipe",
};

afterEach(cleanup);

describe("CatalogClient", () => {
  it("제품 검색이 일치하지 않는 카탈로그 카드를 결과에서 제외한다", () => {
    render(<CatalogClient foods={[acana, otherFood]} />);

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "찾고 있는 사료를 검색하세요",
      }),
      { target: { value: "Grasslands" } },
    );

    expect(screen.getByRole("link", { name: acana.product_name })).toBeTruthy();
    expect(screen.queryByText(otherFood.product_name)).toBeNull();
    expect(screen.getByRole("heading", { name: "검색 결과" })).toBeTruthy();
  });

  it("두 제품을 선택하기 전에는 비교 링크를 비활성으로 유지한다", () => {
    render(<CatalogClient foods={[acana, otherFood]} />);

    expect(
      screen
        .getByRole("link", { name: "선택한 두 제품 비교" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("선택한 두 제품만 비교 링크의 id 순서로 전달한다", () => {
    render(<CatalogClient foods={[acana, otherFood]} />);

    const buttons = screen.getAllByRole("button", { name: "비교 선택" });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    expect(
      screen
        .getByRole("link", { name: "선택한 두 제품 비교" })
        .getAttribute("href"),
    ).toBe("/compare?ids=0,1");
  });

  it("상세 화면에서 넘긴 선택 제품을 유지해 두 번째 제품만 고르게 한다", () => {
    render(<CatalogClient foods={[acana, otherFood]} initialSelectedId={0} />);

    fireEvent.click(screen.getAllByRole("button", { name: "비교 선택" })[0]);

    expect(
      screen
        .getByRole("link", { name: "선택한 두 제품 비교" })
        .getAttribute("href"),
    ).toBe("/compare?ids=0,1");
  });
});
