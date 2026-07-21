import { describe, expect, it } from "vitest";

import { num, validate, type Derived } from "./domain";

// carb/에너지 경고와 무관하게 합계 분기만 보기 위한 중립값
const NEUTRAL: Derived = {
  carb_pct: null,
  carb_is_estimated: false,
  energy_p_pct: null,
  energy_f_pct: null,
  energy_c_pct: null,
  ca_p_ratio: null,
};

const sumErrors = (n: Parameters<typeof validate>[0]) =>
  validate(n, NEUTRAL).filter((f) => f.msg.includes("합계"));

describe("validate 보장성분 합계", () => {
  it("십진 합이 정확히 100%면 통과한다 (부동소수점 누적 오차 허용)", () => {
    // 이 조합의 부동소수점 합은 100.00000000000001이라 엡실론 없이는 오차단된다.
    const input = {
      protein_pct: 25,
      fat_pct: 32.2,
      fiber_pct: 11.9,
      ash_pct: 15.9,
      moisture_pct: 15,
    };
    expect(
      input.protein_pct +
        input.fat_pct +
        input.fiber_pct +
        input.ash_pct +
        input.moisture_pct,
    ).toBeGreaterThan(100);
    expect(sumErrors(input)).toEqual([]);
  });

  it("실제로 100%를 넘으면 여전히 차단한다", () => {
    const flags = sumErrors({
      protein_pct: 30,
      fat_pct: 30,
      fiber_pct: 10,
      ash_pct: 16,
      moisture_pct: 15,
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].level).toBe("error");
  });
});

describe("num 절단 방지", () => {
  it("범위 표기와 소수점 중복은 미기록으로 둔다", () => {
    expect(num("1.9-2.1")).toBeNull();
    expect(num("36-40")).toBeNull();
    expect(num("10.5.2")).toBeNull();
  });

  it("정상 표기는 그대로 읽는다", () => {
    expect(num("36 %")).toBe(36);
    expect(num("3,850 kcal/kg")).toBe(3850);
    expect(num("1.9")).toBe(1.9);
    expect(num("-2")).toBe(-2);
  });
});

describe("validate 열량·열량비", () => {
  const nutrients = { protein_pct: 36, fat_pct: 18 };

  it("자릿수 사고로 보이는 열량을 차단한다", () => {
    // "3.850 kcal/kg"(유럽식 천단위 구분)이 3.85로 파싱된 경우
    const flags = validate({ ...nutrients, kcal_per_kg: 3.85 }, NEUTRAL);
    expect(flags).toContainEqual(expect.objectContaining({ level: "error" }));
  });

  it("정상 건사료 열량에는 플래그가 없다", () => {
    const flags = validate({ ...nutrients, kcal_per_kg: 3850 }, NEUTRAL);
    expect(flags.filter((f) => f.msg.includes("열량"))).toEqual([]);
  });

  it("제조사 표기 열량비 합계가 100%를 벗어나면 차단한다", () => {
    // OCR이 "40% from fat"의 자릿수를 흘려 4%가 된 경우 → 37+4+23 = 64%
    const flags = validate(nutrients, {
      ...NEUTRAL,
      energy_p_pct: 37,
      energy_f_pct: 4,
      energy_c_pct: 23,
    });
    expect(flags).toContainEqual(
      expect.objectContaining({
        level: "error",
        msg: expect.stringContaining("열량비 합계"),
      }),
    );
  });

  it("합이 맞는 열량비는 통과시킨다", () => {
    const flags = validate(nutrients, {
      ...NEUTRAL,
      energy_p_pct: 37,
      energy_f_pct: 40,
      energy_c_pct: 23,
    });
    expect(flags.filter((f) => f.msg.includes("열량비"))).toEqual([]);
  });
});
