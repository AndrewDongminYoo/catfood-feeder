import { NextRequest, NextResponse } from "next/server";
import {
  computeDerived,
  validate,
  type CookingMethod,
  type Source,
} from "@/lib/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type FoodPayload = {
  brand?: string;
  product_name?: string;
  cooking_method?: CookingMethod | null;
  protein_pct?: number | null;
  fat_pct?: number | null;
  fiber_pct?: number | null;
  ash_pct?: number | null;
  moisture_pct?: number | null;
  calcium_pct?: number | null;
  phosphorus_pct?: number | null;
  kcal_per_kg?: number | null;
  mfg_energy?: { p: number | null; f: number | null; c: number | null };
  nutrient_sources?: Record<string, string>;
  ingredients?: unknown;
  flags?: Record<string, boolean>;
  manufacturer_url?: string | null;
  kr_label_source?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const expectedSecret = process.env.ADMIN_WRITE_SECRET;
    const suppliedSecret = req.headers.get("x-admin-secret");
    if (!expectedSecret || suppliedSecret !== expectedSecret) {
      const serverClient = await createClient();
      const {
        data: { user },
      } = await serverClient.auth.getUser();
      if (!user) {
        return NextResponse.json(
          { error: "관리자 로그인이 필요합니다." },
          { status: 401 },
        );
      }
    }

    const payload = (await req.json()) as FoodPayload;
    const brandName = payload.brand?.trim();
    const productName = payload.product_name?.trim();

    if (!brandName || !productName) {
      return NextResponse.json(
        { error: "브랜드와 제품명은 필수입니다." },
        { status: 400 },
      );
    }

    const nutrients = {
      protein_pct: payload.protein_pct,
      fat_pct: payload.fat_pct,
      fiber_pct: payload.fiber_pct,
      ash_pct: payload.ash_pct,
      moisture_pct: payload.moisture_pct,
      calcium_pct: payload.calcium_pct,
      phosphorus_pct: payload.phosphorus_pct,
      kcal_per_kg: payload.kcal_per_kg,
    };
    const derived = computeDerived(
      nutrients,
      payload.cooking_method ?? null,
      (payload.nutrient_sources?.ash_pct as Source | undefined) ?? null,
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

    const supabase = createAdminClient();
    const brand = await findOrCreateBrand(supabase, brandName);
    const flags = payload.flags ?? {};

    const { data, error } = await supabase
      .from("foods")
      .insert({
        brand_id: brand.id,
        product_name: productName,
        cooking_method: payload.cooking_method ?? null,
        ...nutrients,
        carb_pct: derived.carb_pct,
        carb_is_estimated: derived.carb_is_estimated,
        energy_p_pct: derived.energy_p_pct,
        energy_f_pct: derived.energy_f_pct,
        energy_c_pct: derived.energy_c_pct,
        nutrient_sources: {
          ...(payload.nutrient_sources ?? {}),
          ...(derived.carb_pct !== null
            ? { carb_pct: derived.carb_is_estimated ? "estimated" : "derived" }
            : {}),
        },
        ingredients: Array.isArray(payload.ingredients)
          ? payload.ingredients
          : [],
        grain_free: !!flags.grain_free,
        meal_free: !!flags.meal_free,
        has_probiotics: !!flags.has_probiotics,
        has_cranberry: !!flags.has_cranberry,
        has_yucca: !!flags.has_yucca,
        manufacturer_url: payload.manufacturer_url ?? null,
        kr_label_source: payload.kr_label_source ?? null,
        data_verified_at: new Date().toISOString(),
      })
      .select("id, product_name, brand_id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ food: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
    .insert({ name })
    .select("id, name")
    .single();

  if (error) throw new Error(error.message);
  return data;
}
