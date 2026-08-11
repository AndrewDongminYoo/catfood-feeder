// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_FOODS } from "@/lib/fixtures";
import { FoodDossier } from "./food-dossier";

const [acana] = SAMPLE_FOODS;

afterEach(cleanup);

describe("FoodDossier", () => {
  it("표기값과 계산값을 네 개의 제품 설명 렌즈에서 텍스트로 구분한다", () => {
    render(<FoodDossier food={acana} />);

    expect(
      screen.getByRole("heading", { name: "균형을 읽는 법" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "원재료와 다음 질문" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "근거와 미확인 항목" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "리콜 이력의 범위" }),
    ).toBeTruthy();
    expect(screen.getAllByText("제조사 표기").length).toBeGreaterThan(0);
    expect(screen.getAllByText("계산값").length).toBeGreaterThan(0);
    expect(screen.getByText("Duck 11%")).toBeTruthy();
    expect(
      screen.getByText(
        /보증성분의 최소\/최대값을 포함할 수 있어 실제 함량이나 정밀한 점값을 뜻하지 않습니다/,
      ),
    ).toBeTruthy();
  });

  it("비어 있는 영양소와 리콜 목록을 유리한 결론으로 바꾸지 않는다", () => {
    render(
      <FoodDossier
        food={{
          ...acana,
          carb_pct: null,
          ingredients: [],
          nutrient_sources: {
            ...acana.nutrient_sources,
            carb_pct: undefined,
          },
          recalls: [],
        }}
      />,
    );

    expect(screen.getAllByText("미기록").length).toBeGreaterThan(0);
    expect(screen.getByText("확인 필요")).toBeTruthy();
    expect(screen.getByText("원재료 미기록")).toBeTruthy();
    expect(screen.getByText("연결된 리콜 이력이 없습니다.")).toBeTruthy();
    expect(
      screen.getByText(/국내 리콜 이력이 없다는 뜻은 아닙니다/),
    ).toBeTruthy();
    expect(screen.queryByText(/리콜 이력 없음 사료/)).toBeNull();
  });

  it("기록된 리콜의 출처와 대상 로트를 함께 보여 준다", () => {
    render(
      <FoodDossier
        food={{
          ...acana,
          recalls: [
            {
              affected_lots: "LOT-141",
              brand_id: acana.brand_id,
              classification: "Class II",
              external_id: null,
              food_id: acana.id,
              id: 141,
              reason: "Labeling issue",
              recall_date: "2026-08-11",
              recalling_firm: "Example Firm",
              region: "US",
              source: "openFDA Food Enforcement",
              source_url: "https://example.test/recall/141",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("출처: openFDA Food Enforcement")).toBeTruthy();
    expect(screen.getByText("대상 로트: LOT-141")).toBeTruthy();
  });
});
