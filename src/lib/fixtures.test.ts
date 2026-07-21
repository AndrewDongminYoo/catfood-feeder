import { describe, expect, it } from "vitest";

import {
  computeDerived,
  detectSourceConflicts,
  parseManufacturerEnergy,
  resolveAsh,
  validate,
} from "./domain";
import { ACANA_KR, ACANA_MFG, SAMPLE_FOODS } from "./fixtures";

/**
 * CLAUDE.md는 이 ACANA Grasslands 케이스를 "도메인 수학의 회귀 검사"로 규정한다.
 * SAMPLE_FOODS가 손으로 적은 리터럴이라 그 주장이 공허했으므로, 여기서 실제로
 * 도메인 함수를 돌려 픽스처의 값과 대조한다. NFE 공식이나 회분 폴백이 바뀌면 실패한다.
 */
describe("ACANA Grasslands 회귀 픽스처", () => {
  const [acana] = SAMPLE_FOODS;
  const nutrients = {
    protein_pct: acana.protein_pct,
    fat_pct: acana.fat_pct,
    fiber_pct: acana.fiber_pct,
    ash_pct: acana.ash_pct,
    moisture_pct: acana.moisture_pct,
    calcium_pct: acana.calcium_pct,
    phosphorus_pct: acana.phosphorus_pct,
    kcal_per_kg: acana.kcal_per_kg,
  };

  it("파생값이 픽스처에 기록된 수치와 일치한다", () => {
    const derived = computeDerived(
      nutrients,
      acana.cooking_method,
      "kr_label",
      parseManufacturerEnergy(ACANA_MFG) ?? undefined,
    );

    expect(derived).toMatchObject({
      carb_pct: acana.carb_pct,
      energy_p_pct: acana.energy_p_pct,
      energy_f_pct: acana.energy_f_pct,
      energy_c_pct: acana.energy_c_pct,
      ca_p_ratio: acana.ca_p_ratio,
    });
  });

  it("제조사 표기 에너지 분해를 그대로 읽는다", () => {
    // 원문: "with 37% from protein, 23% from carbohydrates, and 40% from fat."
    expect(parseManufacturerEnergy(ACANA_MFG)).toEqual({
      p: 37,
      f: 40,
      c: 23,
    });
  });

  it("회분은 KR 라벨 실측값을 쓰고 추정으로 표시하지 않는다", () => {
    expect(resolveAsh(acana.ash_pct, "kr_label", acana.cooking_method)).toEqual(
      {
        value: 9,
        estimated: false,
      },
    );
  });

  it("검증 플래그가 발생하지 않는다", () => {
    const derived = computeDerived(
      nutrients,
      acana.cooking_method,
      "kr_label",
      parseManufacturerEnergy(ACANA_MFG) ?? undefined,
    );
    expect(validate(nutrients, derived)).toEqual([]);
  });

  it("제조사와 KR 라벨의 실제 불일치를 잡아낸다", () => {
    // 두 원문은 조섬유(4% vs 3%)와 kcal(3850 vs 3930)에서 실제로 다르다.
    const conflicts = detectSourceConflicts(ACANA_MFG, ACANA_KR);
    expect(conflicts.map((conflict) => conflict.key).sort()).toEqual([
      "fiber_pct",
      "kcal_per_kg",
    ]);
  });
});
