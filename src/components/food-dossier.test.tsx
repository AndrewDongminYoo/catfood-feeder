// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_FOODS } from "@/lib/fixtures";
import { FoodDossier } from "./food-dossier";

const [acana] = SAMPLE_FOODS;

afterEach(cleanup);

describe("FoodDossier", () => {
  it("측정값과 계산값을 네 개의 제품 설명 렌즈에서 텍스트로 구분한다", () => {
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
    expect(screen.getAllByText("제조사 근거").length).toBeGreaterThan(0);
    expect(screen.getAllByText("계산값").length).toBeGreaterThan(0);
    expect(screen.getByText("Duck 11%")).toBeTruthy();
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
});
