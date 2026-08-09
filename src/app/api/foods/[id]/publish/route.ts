import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import { COOKING_METHOD_VALUES, SOURCE_VALUES } from "@/lib/domain";
import {
  prepareFoodPublication,
  publishFoodDraftResultSchema,
} from "@/lib/food-publication";
import type { PublishFoodDraftResult } from "@/lib/food-publication";
import { createAdminClient } from "@/lib/supabase/admin";

const nutrientSourcesSchema = z.record(z.string(), z.enum(SOURCE_VALUES));
const publicationDraftRowSchema = z.object({
  ash_pct: z.number().nullable(),
  calcium_pct: z.number().nullable(),
  carb_pct: z.number().nullable(),
  cooking_method: z.enum(COOKING_METHOD_VALUES).nullable(),
  energy_c_pct: z.number().nullable(),
  energy_f_pct: z.number().nullable(),
  energy_p_pct: z.number().nullable(),
  fat_pct: z.number().nullable(),
  fiber_pct: z.number().nullable(),
  kcal_per_kg: z.number().nullable(),
  moisture_pct: z.number().nullable(),
  nutrient_sources: nutrientSourcesSchema,
  phosphorus_pct: z.number().nullable(),
  protein_pct: z.number().nullable(),
  published_at: z.string().nullable(),
  updated_at: z.string(),
});

const DRAFT_FIELDS = [
  "ash_pct",
  "calcium_pct",
  "carb_pct",
  "cooking_method",
  "energy_c_pct",
  "energy_f_pct",
  "energy_p_pct",
  "fat_pct",
  "fiber_pct",
  "kcal_per_kg",
  "moisture_pct",
  "nutrient_sources",
  "phosphorus_pct",
  "protein_pct",
  "published_at",
  "updated_at",
].join(", ");

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied") {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }
  if (authorization.origin === "automation" || authorization.actorId === null) {
    return NextResponse.json(
      { error: "자동화 자격 증명으로는 사료를 발행할 수 없습니다." },
      { status: 403 },
    );
  }

  const foodId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await context.params).id);
  if (!foodId.success) {
    return NextResponse.json(
      { error: "사료 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("foods")
      .select(DRAFT_FIELDS)
      .eq("id", foodId.data)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data === null) {
      return NextResponse.json(
        { error: "대상 사료를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const parsedDraft = publicationDraftRowSchema.safeParse(data);
    if (!parsedDraft.success) {
      throw new Error("Publication draft query returned an invalid row");
    }
    if (parsedDraft.data.published_at !== null) {
      return NextResponse.json(
        { error: "이미 발행된 사료입니다." },
        { status: 409 },
      );
    }

    // 제조사 명시 P/F/C는 source-first 경로에서 컬럼이 아니라 보관 원문에만 남는다.
    const { data: manufacturerSource } = await supabase
      .from("food_sources")
      .select("captured_text")
      .eq("food_id", foodId.data)
      .eq("kind", "manufacturer")
      .eq("fetch_status", "fetched")
      .eq("is_current", true)
      // 사료 하나가 제조사 페이지를 여럿 가질 수 있게 된 뒤로 maybeSingle()은 행이
      // 둘이면 에러가 된다. 이 원문은 P/F/C 선언을 찾는 데만 쓰이므로 가장 먼저
      // 조사된 것(가장 낮은 id)을 쓴다 — 출처가 하나뿐이던 때와 같은 결과다.
      .order("id")
      .limit(1)
      .maybeSingle();

    const preparation = prepareFoodPublication({
      ashPct: parsedDraft.data.ash_pct,
      calciumPct: parsedDraft.data.calcium_pct,
      carbPct: parsedDraft.data.carb_pct,
      cookingMethod: parsedDraft.data.cooking_method,
      energyCPct: parsedDraft.data.energy_c_pct,
      energyFPct: parsedDraft.data.energy_f_pct,
      energyPPct: parsedDraft.data.energy_p_pct,
      fatPct: parsedDraft.data.fat_pct,
      fiberPct: parsedDraft.data.fiber_pct,
      kcalPerKg: parsedDraft.data.kcal_per_kg,
      manufacturerText: manufacturerSource?.captured_text ?? null,
      moisturePct: parsedDraft.data.moisture_pct,
      nutrientSources: parsedDraft.data.nutrient_sources,
      phosphorusPct: parsedDraft.data.phosphorus_pct,
      proteinPct: parsedDraft.data.protein_pct,
      updatedAt: parsedDraft.data.updated_at,
    });
    if (preparation.kind === "invalid") {
      return NextResponse.json({ error: preparation.message }, { status: 400 });
    }

    const publication = await supabase.rpc("publish_food_draft", {
      p_actor_id: authorization.actorId,
      p_derived: preparation.derived,
      p_expected_updated_at: preparation.expectedUpdatedAt,
      p_food_id: foodId.data,
    });
    if (publication.error) throw new Error(publication.error.message);

    const parsedResult = publishFoodDraftResultSchema.safeParse(
      publication.data,
    );
    if (!parsedResult.success) {
      throw new Error("Publication RPC returned an invalid result");
    }

    const result: PublishFoodDraftResult = parsedResult.data;
    switch (result.status) {
      case "published":
        return NextResponse.json({
          food: {
            id: foodId.data,
            publishedAt: result.published_at,
            verificationMethod: "human",
          },
        });
      case "not_found":
        return NextResponse.json(
          { error: "대상 사료를 찾을 수 없습니다." },
          { status: 404 },
        );
      case "already_published":
        return NextResponse.json(
          { error: "이미 발행된 사료입니다." },
          { status: 409 },
        );
      case "stale":
        return NextResponse.json(
          { error: "Draft가 변경되었습니다. 다시 불러온 뒤 시도해주세요." },
          { status: 409 },
        );
      case "no_evidence":
        return NextResponse.json(
          { error: "발행하려면 보존된 성분 근거가 하나 이상 필요합니다." },
          { status: 400 },
        );
      case "missing_evidence":
        return NextResponse.json(
          {
            error: `${result.nutrient_key} 값에 보존된 근거가 없습니다.`,
          },
          { status: 400 },
        );
      case "evidence_mismatch":
        return NextResponse.json(
          {
            error: `${result.nutrient_key} 저장값이 현재 근거와 일치하지 않습니다.`,
          },
          { status: 400 },
        );
      default:
        return assertNever(result);
    }
  } catch (error: unknown) {
    console.error("food publication failed", error);
    return NextResponse.json(
      { error: "카탈로그 저장에 실패했습니다." },
      { status: 500 },
    );
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled publication result: ${JSON.stringify(value)}`);
}
