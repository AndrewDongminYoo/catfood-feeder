// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewFood } from "@/lib/publication-review";
import { PublicationReviewClient } from "./publication-review-client";

function food(overrides: Record<string, unknown>): ReviewFood {
  return {
    brandId: 1,
    carbIsEstimated: false,
    carbPct: 23,
    conflicts: [],
    evidenceCount: 8,
    id: 1,
    nutrientSources: { protein_pct: "manufacturer" as const },
    nutrients: {
      ash_pct: 9,
      fat_pct: 18,
      fiber_pct: 4,
      kcal_per_kg: 3850,
      moisture_pct: 10,
      protein_pct: 36,
    },
    productName: "정상 제품",
    sources: [{ kind: "manufacturer", url: "https://example.test/a" }],
    weightKg: 1.8,
    ...overrides,
  };
}

const reviewResponse = {
  brands: [
    {
      conflicts: 1,
      country: "Canada",
      id: 1,
      koName: "예시",
      name: "Example",
      pending: 3,
    },
  ],
  foods: [
    food({ id: 1, productName: "정상 제품" }),
    food({
      conflicts: [{ key: "fiber_pct", merged_value: 2.3, survivor_value: 3.4 }],
      id: 2,
      productName: "충돌 제품",
    }),
    food({ carbPct: null, id: 3, productName: "탄수 계산불가 제품" }),
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/foods/review")) {
        return new Response(JSON.stringify(reviewResponse), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), {
        status: 500,
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PublicationReviewClient", () => {
  it("검토가 필요한 행은 일괄 선택에 포함하지 않는다", async () => {
    render(
      <PublicationReviewClient
        initialBrands={reviewResponse.brands}
        initialFoods={reviewResponse.foods}
      />,
    );
    await screen.findByText("정상 제품");

    fireEvent.click(screen.getByText("이상 없는 것 모두 선택"));

    // 충돌이 있거나 탄수화물이 계산되지 않는 행이 딸려 들어가면, 사람이 봐야 할
    // 것들이 일괄 발행으로 그대로 공개된다.
    expect(
      (screen.getByLabelText("정상 제품 선택") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText("충돌 제품 선택") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByLabelText("탄수 계산불가 제품 선택") as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(screen.getByText("선택 1건 발행")).toBeTruthy();
  });

  it("브랜드를 고른 뒤에도 다른 브랜드가 목록에 남는다", async () => {
    // 건수를 조회 결과로 세면 필터 중에 나머지가 0건이 되어 목록에서 사라지고,
    // 브랜드를 바꾸려면 "전체"를 한 번 거쳐야 한다.
    render(
      <PublicationReviewClient
        initialBrands={[
          ...reviewResponse.brands,
          {
            conflicts: 0,
            country: "Germany",
            id: 2,
            koName: "다른",
            name: "Other",
            pending: 4,
          },
        ]}
        initialFoods={reviewResponse.foods}
      />,
    );

    fireEvent.change(screen.getByLabelText("브랜드"), {
      target: { value: "1" },
    });

    expect(screen.getByRole("option", { name: /Other/ })).toBeTruthy();
  });

  it("충돌 값을 펼쳐서 양쪽 수치를 보여준다", async () => {
    render(
      <PublicationReviewClient
        initialBrands={reviewResponse.brands}
        initialFoods={reviewResponse.foods}
      />,
    );
    fireEvent.click(await screen.findByText("충돌 제품"));

    expect(screen.getByText("fiber_pct: 3.4 ↔ 2.3")).toBeTruthy();
  });
});
