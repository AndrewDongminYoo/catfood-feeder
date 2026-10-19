// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SAMPLE_FOODS } from "@/lib/fixtures";
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

vi.mock("@/lib/adequacy-repository", () => ({
  getAdequacyProofs: async () => {
    throw new Error("connection failed");
  },
}));
it("keeps the product dossier readable and marks declaration retrieval failure", async () => {
  const html = renderToStaticMarkup(
    await FoodDetailPage({ params: Promise.resolve({ id: "0" }) }),
  );
  expect(html).toContain(SAMPLE_FOODS[0]!.product_name);
  expect(html).toContain("지금은 선언 자료를 불러오지 못했어요");
  expect(html).not.toContain("확보한 자료에서 선언을 확인하지 못했어요");
});
