import { z } from "zod";
import { COOKING_METHOD_VALUES, SOURCE_VALUES } from "./domain";

const sourceSchema = z.enum(SOURCE_VALUES);
const finiteNumberSchema = z.number().finite().nullable().optional();
const sourceConflictSchema = z.object({
  key: z.string(),
  label: z.string(),
  manufacturer: z.number().finite(),
  kr_label: z.number().finite(),
});

/**
 * `/api/foods` 요청 본문. `/new`가 보내는 형태와 정확히 맞아야 한다 —
 * 어긋나면 큐레이터에게는 "요청 형식이 올바르지 않습니다" 한 줄만 보이고
 * 어느 필드가 문제인지 알 방법이 없다. `food-payload.test.ts`가 이 계약을 고정한다.
 */
export const foodPayloadSchema = z
  .object({
    brand: z.string().trim().min(1),
    product_name: z.string().trim().min(1),
    cooking_method: z.enum(COOKING_METHOD_VALUES).nullable().optional(),
    protein_pct: finiteNumberSchema,
    fat_pct: finiteNumberSchema,
    fiber_pct: finiteNumberSchema,
    ash_pct: finiteNumberSchema,
    moisture_pct: finiteNumberSchema,
    calcium_pct: finiteNumberSchema,
    phosphorus_pct: finiteNumberSchema,
    kcal_per_kg: finiteNumberSchema,
    // parseManufacturerEnergy는 "X% from protein" 문구가 없으면 null을 반환하고,
    // 클라이언트는 그 null을 그대로 직렬화해 보낸다. optional()은 undefined만 받으므로
    // 해당 문구가 없는 라벨(대부분의 비-ACANA 제품)은 저장 자체가 불가능했다.
    // null을 받아들이되 computeDerived가 기대하는 undefined로 정규화한다.
    mfg_energy: z
      .object({
        p: z.number().finite().nullable(),
        f: z.number().finite().nullable(),
        c: z.number().finite().nullable(),
      })
      .nullish()
      .transform((value) => value ?? undefined),
    nutrient_sources: z.record(z.string(), sourceSchema).default({}),
    ingredients: z.array(z.json()).max(200).default([]),
    flags: z
      .object({
        grain_free: z.boolean().optional(),
        meal_free: z.boolean().optional(),
        has_probiotics: z.boolean().optional(),
        has_cranberry: z.boolean().optional(),
        has_yucca: z.boolean().optional(),
      })
      .default({}),
    source_conflicts: z.array(sourceConflictSchema).default([]),
  })
  .strict();

export type FoodPayload = z.infer<typeof foodPayloadSchema>;
