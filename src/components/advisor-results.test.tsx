// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdvisorCandidate, AdvisorSelection } from "@/lib/advisor";
import type { FoodWithBrand, NutrientEvidence } from "@/lib/catalog";
import { SAMPLE_FOODS } from "@/lib/fixtures";
import { AdvisorResults, type AdvisorViewState } from "./advisor-results";

afterEach(cleanup);

function food(
  id: number,
  overrides: Partial<FoodWithBrand> = {},
): FoodWithBrand {
  return {
    ...SAMPLE_FOODS[0]!,
    id,
    product_name: `Food ${id}`,
    brands: { ...SAMPLE_FOODS[0]!.brands!, name: `Brand ${id}` },
    recalls: [],
    ...overrides,
  };
}

function evidence(
  nutrientKey: NutrientEvidence["nutrient_key"],
  value: number,
  excerpt: string,
): NutrientEvidence {
  return {
    captured_at: "2026-08-20T00:00:00Z",
    excerpt,
    nutrient_key: nutrientKey,
    source: { capture_method: "fetch", url: "https://example.test/source" },
    value,
  };
}

function selection(
  candidates: readonly AdvisorCandidate[],
  excluded: Extract<AdvisorSelection, { kind: "ready" }>["excluded"] = {
    candidateKcalMissing: 0,
    cookingMethod: 0,
    currentKcalMissing: false,
    declaredCarb: 0,
    kcalOutsideRange: 0,
  },
): Extract<AdvisorSelection, { kind: "ready" }> {
  return { candidates, excluded, kind: "ready" };
}

function renderState(state: AdvisorViewState) {
  return render(<AdvisorResults state={state} />);
}

describe("AdvisorResults", () => {
  it("distinguishes an untouched form from invalid and unavailable states", () => {
    const view = renderState({ kind: "empty" });
    expect(screen.getByTestId("advisor-empty").textContent).toContain(
      "현재 사료를 선택",
    );

    view.rerender(<AdvisorResults state={{ kind: "invalid_query" }} />);
    expect(screen.getByText(/유효한 현재 사료/)).toBeTruthy();

    view.rerender(
      <AdvisorResults
        state={{ kind: "data_unavailable", reason: "load_failed" }}
      />,
    );
    expect(
      screen.getByText(/공개 근거 데이터를 불러오지 못했습니다/),
    ).toBeTruthy();

    view.rerender(
      <AdvisorResults state={{ kind: "current_food_not_found" }} />,
    );
    expect(screen.getByText(/공개 카탈로그에서 찾을 수 없습니다/)).toBeTruthy();
  });

  it("shows exclusion diagnostics when no candidate remains", () => {
    renderState({
      currentFood: food(1),
      kind: "ready",
      selection: selection([], {
        candidateKcalMissing: 3,
        cookingMethod: 4,
        currentKcalMissing: false,
        declaredCarb: 2,
        kcalOutsideRange: 5,
      }),
    });

    expect(screen.getByText("조건을 충족한 후보가 없습니다")).toBeTruthy();
    expect(screen.getByText(/제조 방식 불일치 4개/)).toBeTruthy();
    expect(screen.getByText(/표기 탄수화물 조건 2개/)).toBeTruthy();
    expect(screen.getByText(/후보 사료 열량 근거 미확인 3개/)).toBeTruthy();
    expect(screen.getByText(/열량 범위 밖 5개/)).toBeTruthy();
  });

  it("preserves domain order and exposes evidence, bounds, uncertainty, and recall scope", () => {
    const currentFood = food(1, { product_name: "Current Recipe" });
    const minimumFood = food(2, {
      carb_pct: 23,
      kcal_per_kg: 3900,
      nutrient_sources: {
        carb_pct: "derived",
        kcal_per_kg: "manufacturer",
        protein_pct: "manufacturer",
      },
      product_name: "Minimum Recipe",
    });
    const maximumFood = food(3, {
      carb_pct: 20,
      kcal_per_kg: 3950,
      nutrient_sources: {
        carb_pct: "kr_label",
        kcal_per_kg: "manufacturer",
        protein_pct: "kr_label",
      },
      product_name: "Maximum Recipe",
    });
    const candidates: AdvisorCandidate[] = [
      {
        evidence: [
          evidence("kcal_per_kg", 3900, "3900 kcal/kg"),
          evidence("protein_pct", 36, "Crude Protein (min.) 36%"),
        ],
        food: minimumFood,
        kcalDeltaPct: 1.3,
        matchedReasons: ["kcal_nearby", "cooking_method_match"],
        tradeoffs: ["product_recall_history"],
        unknowns: ["carb_point_comparison_unavailable"],
      },
      {
        evidence: [
          evidence("protein_pct", 36, "조단백질 36% 이하"),
          evidence("carb_pct", 20, "NFE 20%"),
        ],
        food: maximumFood,
        kcalDeltaPct: 2.6,
        matchedReasons: ["kcal_nearby", "declared_carb_available"],
        tradeoffs: ["brand_recall_history"],
        unknowns: ["carb_bound_unspecified"],
      },
    ];

    const { container } = renderState({
      currentFood,
      kind: "ready",
      selection: selection(candidates),
    });

    expect(screen.getByText(/현재 사료: Current Recipe/)).toBeTruthy();
    expect(
      [...container.querySelectorAll("[data-food-id]")].map((card) =>
        card.getAttribute("data-food-id"),
      ),
    ).toEqual(["2", "3"]);
    expect(screen.getByText("현재 대비 열량 1.3% 차이")).toBeTruthy();
    expect(screen.getByText("최소 보증치")).toBeTruthy();
    expect(screen.getByText("최대 보증치")).toBeTruthy();
    expect(screen.getByText("경계 미확인")).toBeTruthy();
    expect(screen.getAllByText("제조사 표기").length).toBeGreaterThan(0);
    expect(screen.getByText("계산값")).toBeTruthy();
    expect(screen.getByText("우열 판단 제외")).toBeTruthy();
    expect(screen.getByText("제품 범위 리콜 이력")).toBeTruthy();
    expect(screen.getByText("브랜드 범위 리콜 이력")).toBeTruthy();
    expect(screen.getAllByText("열량 차이가 가까움")).toHaveLength(2);
    expect(screen.getByText("제조 방식 일치")).toBeTruthy();
    expect(screen.getByText("표기 탄수화물 있음")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Minimum Recipe 근거 상세 보기" })
        .getAttribute("href"),
    ).toBe("/foods/2");
    expect(screen.getByText(/원재료·그레인프리·육분프리/)).toBeTruthy();
    expect(screen.getByText(/건강 상태나 종합 품질/)).toBeTruthy();
  });

  it("literal proof가 없는 저장 영양 수치를 표시하지 않는다", () => {
    const unprovenFood = food(4, {
      carb_pct: 12,
      kcal_per_kg: 1234,
      nutrient_sources: {
        carb_pct: "manufacturer",
        kcal_per_kg: "manufacturer",
        protein_pct: "manufacturer",
      },
      protein_pct: 42,
      product_name: "Unproven Recipe",
    });

    renderState({
      currentFood: food(1),
      kind: "ready",
      selection: selection([
        {
          evidence: [],
          food: unprovenFood,
          kcalDeltaPct: null,
          matchedReasons: [],
          tradeoffs: [],
          unknowns: [
            "candidate_kcal_unknown",
            "protein_unknown",
            "carb_unknown",
          ],
        },
      ]),
    });

    expect(screen.queryByText("1,234 kcal/kg")).toBeNull();
    expect(screen.queryByText("42%")).toBeNull();
    expect(screen.queryByText("12%")).toBeNull();
    expect(screen.getAllByText("미확인")).toHaveLength(3);
    expect(screen.getAllByText("근거 미확인")).toHaveLength(3);
    expect(
      screen.getByText(/열량 차이를 계산할 수 없어 카탈로그 ID 순서/),
    ).toBeTruthy();
  });

  it("후보 열량 근거가 있어도 현재 사료 근거가 없으면 원인을 현재 사료로 표시한다", () => {
    const candidateFood = food(2, { kcal_per_kg: 4100 });

    renderState({
      currentFood: food(1, { kcal_per_kg: 4000 }),
      kind: "ready",
      selection: selection([
        {
          evidence: [evidence("kcal_per_kg", 4100, "4100 kcal/kg")],
          food: candidateFood,
          kcalDeltaPct: null,
          matchedReasons: [],
          tradeoffs: [],
          unknowns: ["current_kcal_unknown"],
        },
      ]),
    });

    expect(screen.getByText("4,100 kcal/kg")).toBeTruthy();
    expect(screen.getByText("현재 사료 열량 근거 미확인")).toBeTruthy();
    expect(screen.queryByText("후보 사료 열량 근거 미확인")).toBeNull();
  });

  it("열량 범위 제외 원인을 현재 사료와 후보 사료로 나눠 표시한다", () => {
    renderState({
      currentFood: food(1),
      kind: "ready",
      selection: selection([], {
        candidateKcalMissing: 2,
        cookingMethod: 0,
        currentKcalMissing: true,
        declaredCarb: 0,
        kcalOutsideRange: 0,
      }),
    });

    expect(screen.getByText(/현재 사료 열량 근거 미확인/)).toBeTruthy();
    expect(screen.getByText(/후보 사료 열량 근거 미확인 2개/)).toBeTruthy();
  });
});
