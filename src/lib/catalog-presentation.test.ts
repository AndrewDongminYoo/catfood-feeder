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
      proof: null,
      value: "36%",
    });
    expect(facts).toContainEqual({
      evidence: { label: "계산값", tone: "derived" },
      key: "ca_p_ratio",
      label: "Ca:P",
      note: expect.any(String),
      proof: {
        formula: "1.9 ÷ 1.3 = 1.462",
        inputs: ["calcium_pct", "phosphorus_pct"],
        kind: "computed",
      },
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
      proof: null,
      value: "—",
    });
  });
});

describe("nutritionFacts proofs", () => {
  const food = SAMPLE_FOODS[0]!;

  it("quotes a fact that has a current evidence row", () => {
    const facts = nutritionFacts(food, [
      {
        captured_at: "2026-08-18T00:00:00Z",
        excerpt: "Crude Protein 36.00%",
        nutrient_key: "protein_pct",
        source: {
          capture_method: "fetch",
          kind: "manufacturer",
          url: "https://example.test/label",
        },
        value: food.protein_pct!,
      },
    ]);

    expect(facts.find((fact) => fact.key === "protein_pct")?.proof).toEqual({
      captureMethod: "fetch",
      capturedAt: "2026-08-18T00:00:00Z",
      excerpt: "Crude Protein 36.00%",
      kind: "quoted",
      url: "https://example.test/label",
      value: food.protein_pct!,
    });
  });

  it("computes carbohydrate when no evidence row exists", () => {
    const proof = nutritionFacts(food, []).find(
      (fact) => fact.key === "carb_pct",
    )?.proof;

    expect(proof?.kind).toBe("computed");
    expect(proof).toMatchObject({
      inputs: [
        "protein_pct",
        "fat_pct",
        "fiber_pct",
        "moisture_pct",
        "ash_pct",
      ],
    });
  });

  it("leaves a fact without evidence unproven rather than guessing", () => {
    expect(
      nutritionFacts(food, []).find((fact) => fact.key === "protein_pct")
        ?.proof,
    ).toBeNull();
  });

  it("탄수화물이 제조사 표기값이면 근거 없이 수식을 붙이지 않는다", () => {
    const manufacturerStated = {
      ...food,
      nutrient_sources: {
        ...food.nutrient_sources,
        carb_pct: "manufacturer" as const,
      },
    };

    expect(
      nutritionFacts(manufacturerStated, []).find(
        (fact) => fact.key === "carb_pct",
      )?.proof,
    ).toBeNull();
  });

  it("익스트루전 회분 폴백을 거친 추정 탄수화물도 계산 근거를 붙인다 (Ruling B 개정)", () => {
    // ash_pct가 null이라 resolveAsh가 9.0% 익스트루전 기본값으로 대체하는 경우.
    // 쓰기 경로(derivedNutrientSources)는 이 경우 carb_pct 태그를 "derived"가
    // 아니라 "estimated"로 붙인다 — 두 태그 모두 evidence 없음 검사와 함께라야
    // 계산값임을 뜻한다.
    const estimatedAsh = {
      ...food,
      ash_pct: null,
      nutrient_sources: {
        ...food.nutrient_sources,
        ash_pct: undefined,
        carb_pct: "estimated" as const,
      },
    };

    const proof = nutritionFacts(estimatedAsh, []).find(
      (fact) => fact.key === "carb_pct",
    )?.proof;

    expect(proof?.kind).toBe("computed");
    expect(proof).toMatchObject({
      inputs: [
        "protein_pct",
        "fat_pct",
        "fiber_pct",
        "moisture_pct",
        "ash_pct",
      ],
    });
  });
});
