import { describe, expect, it } from "vitest";
import type { NutrientEvidence } from "./catalog";
import { SAMPLE_FOODS } from "./fixtures";
import {
  evidenceState,
  type NutritionProof,
  nutritionFacts,
} from "./catalog-presentation";

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
        inputs: [
          {
            evidence: { label: "제조사 표기", tone: "declared" },
            key: "calcium_pct",
            label: "칼슘",
            proof: null,
            value: "1.9%",
          },
          {
            evidence: { label: "제조사 표기", tone: "declared" },
            key: "phosphorus_pct",
            label: "인",
            proof: null,
            value: "1.3%",
          },
        ],
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

function evidenceRow(
  nutrient_key: NutrientEvidence["nutrient_key"],
  value: number,
  excerpt: string,
): NutrientEvidence {
  return {
    captured_at: "2026-08-18T00:00:00Z",
    excerpt,
    nutrient_key,
    source: { capture_method: "fetch", url: "https://example.test/label" },
    value,
  };
}

function inputs(proof: NutritionProof | null | undefined) {
  return proof?.kind === "computed" ? proof.inputs : [];
}

function inputKeys(proof: NutritionProof | null | undefined) {
  return inputs(proof).map((input) => input.key);
}

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
    expect(inputKeys(proof)).toEqual([
      "protein_pct",
      "fat_pct",
      "fiber_pct",
      "moisture_pct",
      "ash_pct",
    ]);
  });

  it("계산 근거의 각 항에 그 항의 인용문을 붙인다", () => {
    const proof = nutritionFacts(food, [
      evidenceRow("fiber_pct", food.fiber_pct!, "Crude fiber (max.) 4 %"),
    ]).find((fact) => fact.key === "carb_pct")?.proof;

    const fiber = inputs(proof).find((input) => input.key === "fiber_pct");
    expect(fiber?.label).toBe("조섬유");
    expect(fiber?.value).toBe("4%");
    expect(fiber?.proof).toMatchObject({
      excerpt: "Crude fiber (max.) 4 %",
      kind: "quoted",
      value: 4,
    });
    // 근거 행이 없는 항은 빈 인용이 아니라 인용 없는 항으로 남는다.
    expect(
      inputs(proof).find((input) => input.key === "moisture_pct")?.proof,
    ).toBeNull();
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

    const proof = nutritionFacts(estimatedAsh, [
      // 회분 값과 같은 숫자를 가진 지난 근거 행이 있어도, 수식에 들어간 9.0%는
      // 폴백에서 온 값이므로 인용을 붙이면 안 된다.
      evidenceRow("ash_pct", 9, "조회분 9.0% 이하"),
    ]).find((fact) => fact.key === "carb_pct")?.proof;

    expect(proof?.kind).toBe("computed");
    expect(inputKeys(proof)).toEqual([
      "protein_pct",
      "fat_pct",
      "fiber_pct",
      "moisture_pct",
      "ash_pct",
    ]);

    const ash = inputs(proof).find((input) => input.key === "ash_pct");
    expect(ash).toMatchObject({
      evidence: { label: "추정값", tone: "estimated" },
      label: "조회분",
      proof: null,
      value: "9%",
    });
  });

  it("표시값과 다른 값을 가진 근거는 인용하지 않고 배지로 물러난다", () => {
    // `public-foods` 와 `public-food-evidence` 는 각자 1시간 캐시라, 큐레이터가
    // 근거를 교체한 직후 두 캐시가 다른 시점을 담을 수 있다.
    const facts = nutritionFacts(food, [
      evidenceRow("protein_pct", 34, "Crude Protein 34.00%"),
    ]);

    expect(facts.find((fact) => fact.key === "protein_pct")?.proof).toBeNull();
  });

  it("컬럼 스케일 안의 정밀도 차이는 어긋남으로 보지 않는다", () => {
    // foods 는 numeric(_,2), 근거 원장은 라벨의 원본 정밀도를 보존한다.
    // supabase/tests/publication_precision_test.sql 이 "인 0.895% 이상" 을
    // 0.90 으로 저장하는 경로를 고정해 두었다.
    const caP = nutritionFacts({ ...food, phosphorus_pct: 0.9 }, [
      evidenceRow("phosphorus_pct", 0.895, "인 0.895% 이상"),
    ]).find((fact) => fact.key === "ca_p_ratio")?.proof;

    if (caP?.kind !== "computed") throw new Error("computed proof expected");
    expect(
      caP.inputs.find((input) => input.key === "phosphorus_pct")?.proof
        ?.excerpt,
    ).toBe("인 0.895% 이상");
  });

  it("컬럼이 다른 값으로 반올림되는 근거는 인용하지 않는다", () => {
    // 0.895 와 0.905 는 0.90 에서 절대 거리가 같지만, numeric(_,2) 로 저장하면
    // 각각 0.90 과 0.91 이 된다 — 거리로 비교하면 이 둘을 구분할 수 없다.
    const caP = nutritionFacts({ ...food, phosphorus_pct: 0.9 }, [
      evidenceRow("phosphorus_pct", 0.905, "인 0.905% 이상"),
    ]).find((fact) => fact.key === "ca_p_ratio")?.proof;

    if (caP?.kind !== "computed") throw new Error("computed proof expected");
    expect(
      caP.inputs.find((input) => input.key === "phosphorus_pct")?.proof,
    ).toBeNull();
  });
});
