// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_FOODS } from "@/lib/fixtures";

const mocks = vi.hoisted(() => ({
  getFoods: vi.fn(),
}));

vi.mock("@/lib/catalog", () => ({
  getFoods: mocks.getFoods,
}));

import FoodsPage from "./page";

describe("FoodsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFoods.mockResolvedValue(SAMPLE_FOODS);
  });

  afterEach(cleanup);

  it("uses the first repeated compare value as the initial selection", async () => {
    render(
      await FoodsPage({
        searchParams: Promise.resolve({ compare: ["0", "1"] }),
      }),
    );

    expect(screen.getByRole("button", { name: "비교 해제" })).toBeTruthy();
  });
});
