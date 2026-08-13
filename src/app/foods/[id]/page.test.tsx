// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import FoodDetailPage from "./page";

afterEach(cleanup);

describe("FoodDetailPage", () => {
  it("현재 제품을 선택한 채로 두 번째 제품을 고를 수 있는 카탈로그로 이동한다", async () => {
    render(await FoodDetailPage({ params: Promise.resolve({ id: "0" }) }));

    expect(
      screen
        .getByRole("link", {
          name: "이 제품을 기준으로 다른 사료 비교하기",
        })
        .getAttribute("href"),
    ).toBe("/foods?compare=0");
  });
});
