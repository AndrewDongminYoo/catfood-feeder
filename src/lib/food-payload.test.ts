import { describe, expect, it } from "vitest";

import { NUTRIENT_FIELDS, parseManufacturerEnergy } from "./domain";
import { foodPayloadSchema } from "./food-payload";

/** `/new`의 save()가 만드는 본문 형태. 필드 구성이 어긋나면 여기서 잡힌다. */
function payloadFromNewPage(overrides: Record<string, unknown> = {}) {
  return {
    product_name: "LEONARDO fresh Duck",
    brand: "LEONARDO",
    cooking_method: null,
    protein_pct: 40,
    fat_pct: 22,
    fiber_pct: 2.5,
    ash_pct: 7,
    moisture_pct: 10,
    calcium_pct: 1,
    phosphorus_pct: 0.9,
    kcal_per_kg: null,
    mfg_energy: null,
    nutrient_sources: { protein_pct: "manufacturer", fat_pct: "manufacturer" },
    ingredients: [{ name: "Fresh poultry meat", pct: 30, type: "meat" }],
    flags: { grain_free: true, has_cranberry: true },
    source_conflicts: [],
    ...overrides,
  };
}

describe("foodPayloadSchema", () => {
  // `/new`는 NUTRIENT_FIELDS로 본문을 만들고 이 스키마는 strict()다. 둘이 어긋나면
  // 큐레이터에게는 "요청 형식이 올바르지 않습니다" 한 줄만 보이고 모든 저장이 막힌다 —
  // carb_pct를 추가했을 때 실제로 그렇게 됐고, 나머지 243개 테스트는 모두 통과했다.
  it.each(NUTRIENT_FIELDS.map(([key]) => key))(
    "%s 를 본문에 담아도 거부하지 않는다",
    (key) => {
      const parsed = foodPayloadSchema.safeParse(
        payloadFromNewPage({ [key]: 12.5 }),
      );
      expect(parsed.success).toBe(true);
    },
  );

  it("성분 키가 하나도 빠지지 않은 본문을 통과시킨다", () => {
    const everyKey = Object.fromEntries(
      NUTRIENT_FIELDS.map(([key]) => [key, 5]),
    );
    const parsed = foodPayloadSchema.safeParse(payloadFromNewPage(everyKey));
    expect(parsed.success).toBe(true);
  });

  it('제조사 원문에 "X% from protein" 문구가 없으면 mfg_energy는 null로 전송된다', () => {
    // LEONARDO 라벨에는 해당 문구가 없다. ACANA에는 있어서 픽스처로는 드러나지 않았다.
    const leonardo =
      "Protein 40% Fat content 22% Crude fibre 2.5% Crude ash 7% Moisture 10%";
    expect(parseManufacturerEnergy(leonardo)).toBeNull();
  });

  it("mfg_energy가 null이어도 저장을 거부하지 않는다", () => {
    const parsed = foodPayloadSchema.safeParse(payloadFromNewPage());
    expect(parsed.success).toBe(true);
    // computeDerived는 undefined만 받으므로 경계에서 정규화돼야 한다.
    if (parsed.success) expect(parsed.data.mfg_energy).toBeUndefined();
  });

  it("제조사가 열량비를 명시한 경우 그대로 통과시킨다", () => {
    const parsed = foodPayloadSchema.safeParse(
      payloadFromNewPage({ mfg_energy: { p: 37, f: 40, c: 23 } }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.mfg_energy).toEqual({ p: 37, f: 40, c: 23 });
  });

  it("알 수 없는 필드는 계속 거부한다", () => {
    const parsed = foodPayloadSchema.safeParse(
      payloadFromNewPage({ weight_kg: 2 }),
    );
    expect(parsed.success).toBe(false);
  });
});
