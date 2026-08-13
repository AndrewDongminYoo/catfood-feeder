// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_FOODS } from "@/lib/fixtures";

const mocks = vi.hoisted(() => ({
  getComparisonFoods: vi.fn(),
}));

vi.mock("@/lib/catalog", () => ({
  getComparisonFoods: mocks.getComparisonFoods,
}));

import ComparePage from "./page";

const [firstFood] = SAMPLE_FOODS;
const secondFood = {
  ...firstFood,
  id: 1,
  product_name: "Second Recipe",
};

describe("ComparePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getComparisonFoods.mockResolvedValue([firstFood, secondFood]);
  });

  afterEach(cleanup);

  it("uses the first repeated ids value for comparison", async () => {
    render(
      await ComparePage({
        searchParams: Promise.resolve({ ids: ["0,1", "2"] }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "차이를 확인하세요" }),
    ).toBeTruthy();
    expect(screen.getByText(secondFood.product_name)).toBeTruthy();
  });
});
