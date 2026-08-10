import { NextRequest, NextResponse } from "next/server";
import { authorizeCurator } from "@/lib/admin-auth";
import {
  NUTRIENT_FIELDS,
  computeDerived,
  isMeasured,
  resolveAsh,
  validate,
} from "@/lib/domain";
import type { Source } from "@/lib/domain";
import {
  RequestBodyTooLargeError,
  TRANSCRIPT_JSON_BODY_BYTES,
  formatBodyLimit,
  readJsonBody,
} from "@/lib/request-body";
import { foodPayloadSchema, type FoodPayload } from "@/lib/food-payload";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied") {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }

  try {
    const parsedPayload = foodPayloadSchema.safeParse(
      await readJsonBody(req, TRANSCRIPT_JSON_BODY_BYTES),
    );
    if (!parsedPayload.success) {
      return NextResponse.json(
        { error: "요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const payload = parsedPayload.data;
    const cookingMethod = payload.cooking_method ?? null;
    const suppliedAshSource = payload.nutrient_sources.ash_pct ?? null;
    const resolvedAsh = resolveAsh(
      payload.ash_pct,
      suppliedAshSource,
      cookingMethod,
    );
    // 라벨이 NFE를 직접 쓴 경우에만 저장된 carb를 실측으로 계산에 넘긴다.
    // food-publication.ts와 같은 판정이다 — 계산으로 채워진 값을 되돌려 넣으면
    // 역산 결과가 자기 자신을 입력으로 삼아 실측으로 굳는다.
    const statedCarb = isMeasured(payload.nutrient_sources.carb_pct)
      ? (payload.carb_pct ?? null)
      : null;
    const nutrients = {
      protein_pct: payload.protein_pct ?? null,
      fat_pct: payload.fat_pct ?? null,
      fiber_pct: payload.fiber_pct ?? null,
      ash_pct: resolvedAsh.value,
      moisture_pct: payload.moisture_pct ?? null,
      calcium_pct: payload.calcium_pct ?? null,
      phosphorus_pct: payload.phosphorus_pct ?? null,
      kcal_per_kg: payload.kcal_per_kg ?? null,
      carb_pct: statedCarb,
    };
    // 출처 검사만은 걸러내기 전의 원본 입력을 봐야 한다. 걸러낸 값을 넘기면 태그
    // 없이 들어온 carb가 null로 보여 검사를 통과하고, 출처 없는 숫자가 저장된다.
    const missingSources = missingNutrientSources(
      { ...nutrients, carb_pct: payload.carb_pct ?? null },
      payload.nutrient_sources,
    );
    if (missingSources.length > 0) {
      return NextResponse.json(
        { error: `출처가 없는 성분값: ${missingSources.join(", ")}` },
        { status: 400 },
      );
    }

    const derived = computeDerived(
      nutrients,
      cookingMethod,
      suppliedAshSource,
      payload.mfg_energy,
    );
    const errors = validate(nutrients, derived).filter(
      (flag) => flag.level === "error",
    );
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.map((flag) => flag.msg).join(" / ") },
        { status: 400 },
      );
    }

    const nutrientSources = derivedNutrientSources(
      payload.nutrient_sources,
      resolvedAsh.estimated,
      derived,
      payload.mfg_energy,
    );
    const supabase = createAdminClient();
    const brand = await findOrCreateBrand(supabase, payload.brand);
    const flags = payload.flags;
    const publishedAt =
      authorization.origin === "human" ? new Date().toISOString() : null;

    const { data, error } = await supabase
      .from("foods")
      .insert({
        brand_id: brand.id,
        product_name: payload.product_name,
        cooking_method: cookingMethod,
        ...nutrients,
        carb_pct: derived.carb_pct,
        carb_is_estimated: derived.carb_is_estimated,
        energy_p_pct: derived.energy_p_pct,
        energy_f_pct: derived.energy_f_pct,
        energy_c_pct: derived.energy_c_pct,
        nutrient_sources: nutrientSources,
        ingredients: payload.ingredients,
        grain_free: flags.grain_free ?? false,
        meal_free: flags.meal_free ?? false,
        has_probiotics: flags.has_probiotics ?? false,
        has_cranberry: flags.has_cranberry ?? false,
        has_yucca: flags.has_yucca ?? false,
        source_conflicts: payload.source_conflicts,
        data_verified_at: publishedAt,
        published_at: publishedAt,
        published_by:
          authorization.origin === "human" ? authorization.actorId : null,
        verification_method: authorization.origin === "human" ? "human" : null,
      })
      .select("id, product_name, brand_id")
      .single();

    if (error) {
      console.error("food insert failed", error);
      return NextResponse.json(
        { error: "카탈로그 저장에 실패했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({ food: data });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        {
          error: `요청 본문은 ${formatBodyLimit(TRANSCRIPT_JSON_BODY_BYTES)} 이하여야 합니다.`,
        },
        { status: 413 },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "요청 JSON 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    console.error("food insert failed", error);
    return NextResponse.json(
      { error: "카탈로그 저장에 실패했습니다." },
      { status: 500 },
    );
  }
}

function missingNutrientSources(
  nutrients: Record<string, number | null>,
  nutrientSources: Record<string, Source>,
): readonly string[] {
  return NUTRIENT_FIELDS.flatMap(([key, label]) =>
    nutrients[key] !== null && !nutrientSources[key] ? [label] : [],
  );
}

function derivedNutrientSources(
  suppliedSources: Record<string, Source>,
  ashIsEstimated: boolean,
  derived: ReturnType<typeof computeDerived>,
  mfgEnergy: FoodPayload["mfg_energy"],
): Record<string, Source> {
  const nutrientSources = { ...suppliedSources };
  if (ashIsEstimated) nutrientSources.ash_pct = "estimated";
  // 실측 carb는 태그를 그대로 둔다. 여기서 derived로 덮으면 라벨이 쓴 값이
  // 계산값으로 둔갑해 measured/estimated 구분이 무너진다.
  if (!isMeasured(suppliedSources.carb_pct) && derived.carb_pct !== null) {
    nutrientSources.carb_pct = derived.carb_is_estimated
      ? "estimated"
      : "derived";
  }

  const hasManufacturerEnergy =
    mfgEnergy !== undefined &&
    mfgEnergy.p !== null &&
    mfgEnergy.f !== null &&
    mfgEnergy.c !== null;
  if (derived.energy_p_pct !== null) {
    const source = hasManufacturerEnergy ? "manufacturer" : "derived";
    nutrientSources.energy_p_pct = source;
    nutrientSources.energy_f_pct = source;
    nutrientSources.energy_c_pct = source;
  }
  return nutrientSources;
}

async function findOrCreateBrand(
  supabase: ReturnType<typeof createAdminClient>,
  name: string,
) {
  const { data: existing, error: selectError } = await supabase
    .from("brands")
    .select("id, name")
    .ilike("name", name)
    .is("manufacturer", null)
    .maybeSingle();

  if (selectError) throw new Error(selectError.message);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("brands")
    // ko_name은 국내 표기이자 적재 매칭 키다. 조사로 정규명이 확정되기 전까지는
    // 들어온 이름이 곧 국내 표기다.
    .insert({ ko_name: name, name })
    .select("id, name")
    .single();

  if (error) throw new Error(error.message);
  return data;
}
