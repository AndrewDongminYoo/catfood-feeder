import { describe, expect, it } from "vitest";
import { SAMPLE_FOODS } from "./fixtures";
import { evidenceState, nutritionFacts } from "./catalog-presentation";

describe("catalog presentation", () => {
  it("출처 종류와 비어 있는 값을 서로 다른 텍스트 상태로 표시한다", () => {
    expect(evidenceState("manufacturer", 36)).toEqual({
      label: "제조사 표기",
      tone: "declared",
    });
    expect(evidenceState("kr_label", 9)).toEqual({
      label: "국내 라벨 표기",
      tone: "declared",
    });
    expect(evidenceState("estimated", 23)).toEqual({
      label: "추정값",
      tone: "estimated",
    });
    expect(evidenceState("derived", 23)).toEqual({
      label: "계산값",
      tone: "derived",
    });
    expect(evidenceState(undefined, null)).toEqual({
      label: "미기록",
      tone: "unknown",
    });
  });

  it("공개 지표에 저장된 출처를 붙이고 Ca:P는 계산값으로 남긴다", () => {
    const [food] = SAMPLE_FOODS;
    const facts = nutritionFacts(food);

    expect(facts.map((fact) => fact.key)).toEqual([
      "protein_pct",
      "fat_pct",
      "carb_pct",
      "kcal_per_kg",
      "energy_p_pct",
      "energy_f_pct",
      "energy_c_pct",
      "ca_p_ratio",
    ]);
    expect(facts).toContainEqual({
      evidence: { label: "제조사 표기", tone: "declared" },
      key: "protein_pct",
      label: "단백질",
      note: null,
      value: "36%",
    });
    expect(facts).toContainEqual({
      evidence: { label: "계산값", tone: "derived" },
      key: "ca_p_ratio",
      label: "Ca:P",
      note: expect.any(String),
      value: "1.46",
    });
  });

  it("비어 있는 탄수화물을 미기록으로 숨기지 않는다", () => {
    const [food] = SAMPLE_FOODS;
    const facts = nutritionFacts({
      ...food,
      carb_pct: null,
      nutrient_sources: {
        ...food.nutrient_sources,
        carb_pct: undefined,
      },
    });

    expect(facts).toContainEqual({
      evidence: { label: "미기록", tone: "unknown" },
      key: "carb_pct",
      label: "탄수화물",
      note: expect.any(String),
      value: "—",
    });
  });
});
