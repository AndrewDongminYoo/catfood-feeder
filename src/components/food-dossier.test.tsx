// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
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
              scope: "product",
              source: "openFDA Food Enforcement",
              source_url: "https://example.test/recall/141",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("출처: openFDA Food Enforcement")).toBeTruthy();
    expect(screen.getByText("대상 로트: LOT-141")).toBeTruthy();
    expect(screen.getByText("제품 연결 이력")).toBeTruthy();
    expect(
      screen.queryByText("이 제품·로트의 해당 여부는 확인되지 않았습니다."),
    ).toBeNull();
  });

  it("브랜드 범위 이력을 제품 리콜로 단정하지 않는다", () => {
    render(
      <FoodDossier
        food={{
          ...acana,
          recalls: [
            {
              affected_lots: "BRAND-LOT",
              brand_id: acana.brand_id,
              classification: "Class II",
              external_id: null,
              food_id: null,
              id: 143,
              reason: "Brand-scoped issue",
              recall_date: "2026-08-12",
              recalling_firm: "Example Firm",
              region: "US",
              scope: "brand",
              source: "openFDA Food Enforcement",
              source_url: "https://example.test/recall/143",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("브랜드 범위 이력")).toBeTruthy();
    expect(
      screen.getByText("이 제품·로트의 해당 여부는 확인되지 않았습니다."),
    ).toBeTruthy();
  });

  it("expands a quoted fact to its excerpt, source, and capture time", () => {
    render(
      <FoodDossier
        food={SAMPLE_FOODS[0]!}
        evidence={[
          {
            captured_at: "2026-08-18T00:00:00Z",
            excerpt: "Crude Protein 36.00%",
            nutrient_key: "protein_pct",
            source: {
              capture_method: "fetch",
              url: "https://example.test/label",
            },
            value: SAMPLE_FOODS[0]!.protein_pct!,
          },
        ]}
      />,
    );

    for (const mark of screen.getAllByText("36.00")) {
      expect(mark.tagName).toBe("MARK");
    }
    expect(
      document.querySelector('a[href="https://example.test/label"]'),
    ).toBeTruthy();
  });

  it("계산값을 수식과 각 입력 항목의 근거로 함께 펼친다", () => {
    render(
      <FoodDossier
        food={acana}
        evidence={[
          {
            captured_at: "2026-08-18T00:00:00Z",
            excerpt: "Crude fiber (max.) 4 %",
            nutrient_key: "fiber_pct",
            source: {
              capture_method: "fetch",
              url: "https://example.test/label",
            },
            value: acana.fiber_pct!,
          },
        ]}
      />,
    );

    const carbFormula = screen.getByText(/^100 − \(/);
    const carbRow = carbFormula.closest("details");
    expect(carbRow).toBeTruthy();
    // 다섯 항이 모두 이름과 값으로 나타난다 — 수식만 보여 주는 상태가 아니다.
    for (const label of ["단백질", "지방", "조섬유", "수분", "조회분"]) {
      expect(within(carbRow!).getAllByText(label).length).toBeGreaterThan(0);
    }
    // 근거가 있는 항만 그 항의 인용문까지 펼쳐진다.
    expect(within(carbRow!).getByText("4").tagName).toBe("MARK");
    expect(within(carbRow!).queryByText("Crude Protein 36.00%")).toBeNull();
  });

  it("폴백으로 채운 회분 항을 인용 없이 추정값으로 밝힌다", () => {
    render(
      <FoodDossier
        food={{
          ...acana,
          ash_pct: null,
          nutrient_sources: {
            ...acana.nutrient_sources,
            ash_pct: undefined,
            carb_pct: "estimated",
          },
        }}
      />,
    );

    const carbRow = screen.getByText(/^100 − \(/).closest("details")!;
    const ashTerm = within(carbRow)
      .getByText("조회분")
      .closest(".proof-input")!;
    expect(ashTerm.textContent).toContain("9%");
    expect(ashTerm.textContent).toContain("추정값");
    // 인용할 구절이 없는 항은 빈 펼침이 아니라 배지만 달린 줄이다.
    expect(ashTerm.closest("details")).toBe(carbRow);
    expect(ashTerm.querySelector("blockquote")).toBeNull();
  });

  it("주의 문구를 접힌 상태에서도 보여 주되 펼침 컨트롤 안에 넣지 않는다", () => {
    render(<FoodDossier food={acana} />);

    const note = screen.getByText(
      "탄수화물 수치는 근거 상태와 함께 확인하세요.",
    );
    // details 밖 — 접혀 있어도 보인다.
    expect(note.closest("details")).toBeNull();
    // summary 밖 — 펼침 컨트롤의 접근성 이름에 섞이지 않는다.
    expect(note.closest("summary")).toBeNull();
    const carbSummary = screen
      .getByText(/^100 − \(/)
      .closest("details")!
      .querySelector("summary")!;
    expect(carbSummary.textContent).not.toContain("탄수화물 수치는");
  });

  it("매치가 없는 인용문도 같은 정규화를 거쳐 그린다", () => {
    render(
      <FoodDossier
        food={acana}
        evidence={[
          {
            captured_at: "2026-08-18T00:00:00Z",
            excerpt: "조단백질 ３９％",
            nutrient_key: "protein_pct",
            source: {
              capture_method: "fetch",
              url: "https://example.test/label",
            },
            value: acana.protein_pct!,
          },
        ]}
      />,
    );

    expect(screen.getAllByText("조단백질 39%").length).toBeGreaterThan(0);
    expect(screen.queryByText("조단백질 ３９％")).toBeNull();
  });

  it("renders an unmatched excerpt without marking any number", () => {
    render(
      <FoodDossier
        food={SAMPLE_FOODS[0]!}
        evidence={[
          {
            captured_at: "2026-08-18T00:00:00Z",
            excerpt: "Crude Protein not stated",
            nutrient_key: "protein_pct",
            source: {
              capture_method: "fetch",
              url: "https://example.test/label",
            },
            value: SAMPLE_FOODS[0]!.protein_pct!,
          },
        ]}
      />,
    );

    expect(
      screen.getAllByText("Crude Protein not stated").length,
    ).toBeGreaterThan(0);
    expect(document.querySelector("mark")).toBeNull();
  });
});
