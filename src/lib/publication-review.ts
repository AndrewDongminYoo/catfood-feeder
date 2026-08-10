import { computeDerived, isMeasured } from "./domain";
import type { CookingMethod, Source } from "./domain";
import { selectAll } from "../../scripts/select-all.mjs";
import { createAdminClient } from "./supabase/admin";

/**
 * 발행 검토 목록의 조회·집계.
 *
 * 서버 컴포넌트와 API 라우트가 같은 것을 봐야 한다. 화면이 처음 그릴 때와 브랜드를
 * 바꿀 때 서로 다른 계산을 하면, 같은 사료가 두 순간에 다르게 보인다.
 *
 * 판정("발행 가능")이 아니라 사실을 돌려준다 — 미리보기와 실제 발행이 각자 계산하면
 * 화면이 조용히 거짓말을 한다. 최종 판정은 발행 라우트가 한다.
 */
export type ReviewFood = {
  readonly brandId: number;
  readonly carbIsEstimated: boolean;
  readonly carbPct: number | null;
  readonly conflicts: readonly unknown[];
  readonly evidenceCount: number;
  readonly id: number;
  readonly nutrients: Readonly<Record<string, number | null>>;
  readonly nutrientSources: Readonly<Record<string, Source>>;
  readonly productName: string;
  readonly sources: readonly { readonly kind: string; readonly url: string }[];
  readonly weightKg: number | null;
};

export type ReviewBrand = {
  readonly conflicts: number;
  readonly country: string | null;
  readonly id: number;
  readonly koName: string | null;
  readonly name: string;
  readonly pending: number;
};

export type ReviewListing = {
  readonly brands: readonly ReviewBrand[];
  readonly foods: readonly ReviewFood[];
};

export async function loadPublicationReview(
  brandId: number | null,
): Promise<ReviewListing> {
  const supabase = createAdminClient();

  const { data: brandRows, error: brandError } = await supabase
    .from("brands")
    .select("id, name, ko_name, country")
    .order("name");
  if (brandError) throw new Error(brandError.message);

  const query = supabase
    .from("foods")
    .select(
      "id, product_name, weight_kg, cooking_method, protein_pct, fat_pct, fiber_pct, ash_pct, moisture_pct, calcium_pct, phosphorus_pct, kcal_per_kg, carb_pct, nutrient_sources, source_conflicts, brand_id",
    )
    .is("published_at", null)
    .not("protein_pct", "is", null)
    .order("product_name");
  const { data: foodRows, error: foodError } = await (brandId === null
    ? query
    : query.eq("brand_id", brandId));
  if (foodError) throw new Error(foodError.message);

  const foodIds = (foodRows ?? []).map((food) => food.id);
  const evidenceByFood = new Map<number, number>();
  const sourceByFood = new Map<number, { kind: string; url: string }[]>();

  if (foodIds.length > 0) {
    // 근거는 사료 하나당 성분 키 수만큼 쌓인다(현재 9개). PostgREST는 1000행에서
    // 오류 없이 잘라내므로, 잘리는 순간 그 뒤 사료의 근거 수가 0으로 보이고 화면은
    // 그걸 "근거 없음"으로 읽는다. 완전함이 판단을 좌우하는 조회라 페이지로 넘긴다.
    const [evidence, sources] = await Promise.all([
      selectAll(
        async (from, to) =>
          await supabase
            .from("food_nutrient_evidence")
            .select("food_id")
            .eq("is_current", true)
            .in("food_id", foodIds)
            .order("id")
            .range(from, to),
      ) as Promise<{ food_id: number }[]>,
      selectAll(
        async (from, to) =>
          await supabase
            .from("food_sources")
            .select("food_id, kind, url")
            .eq("is_current", true)
            .eq("fetch_status", "fetched")
            .in("food_id", foodIds)
            .order("id")
            .range(from, to),
      ) as Promise<{ food_id: number; kind: string; url: string }[]>,
    ]);
    for (const row of evidence) {
      evidenceByFood.set(
        row.food_id,
        (evidenceByFood.get(row.food_id) ?? 0) + 1,
      );
    }
    for (const row of sources) {
      sourceByFood.set(row.food_id, [
        ...(sourceByFood.get(row.food_id) ?? []),
        { kind: row.kind, url: row.url },
      ]);
    }
  }

  const foods: ReviewFood[] = (foodRows ?? []).map((food) => {
    const nutrientSources = (food.nutrient_sources ?? {}) as Record<
      string,
      Source
    >;
    // 발행이 쓰는 것과 같은 계산이다. 회분 폴백(익스트루전 9.0% estimated)이 여기에도
    // 걸리므로, 회분을 표기하지 않는 라벨이 계산 불가로 잘못 보이지 않는다.
    //
    // 저장된 carb도 발행과 같은 판정을 거친다. 그냥 넘기면 역산으로 채워진 값이
    // 라벨 선언값으로 읽혀 estimated 표시가 사라지고, 검토 화면은 발행이 추정으로
    // 표시할 사료를 실측으로 보여준다.
    const derived = computeDerived(
      {
        ...food,
        carb_pct: isMeasured(nutrientSources.carb_pct) ? food.carb_pct : null,
      },
      food.cooking_method as CookingMethod | null,
      nutrientSources.ash_pct ?? null,
    );
    return {
      brandId: food.brand_id,
      carbIsEstimated: derived.carb_is_estimated,
      carbPct: derived.carb_pct,
      conflicts: Array.isArray(food.source_conflicts)
        ? food.source_conflicts
        : [],
      evidenceCount: evidenceByFood.get(food.id) ?? 0,
      id: food.id,
      nutrientSources,
      nutrients: {
        ash_pct: food.ash_pct,
        calcium_pct: food.calcium_pct,
        fat_pct: food.fat_pct,
        fiber_pct: food.fiber_pct,
        kcal_per_kg: food.kcal_per_kg,
        moisture_pct: food.moisture_pct,
        phosphorus_pct: food.phosphorus_pct,
        protein_pct: food.protein_pct,
      },
      productName: food.product_name,
      sources: sourceByFood.get(food.id) ?? [],
      weightKg: food.weight_kg,
    };
  });

  // 브랜드별 건수는 필터와 무관하게 전체에서 센다. 조회 결과로 세면 브랜드를 고르는
  // 순간 나머지가 모두 0건이 되어 드롭다운에서 사라지고, 다른 브랜드로 바꾸려면
  // "전체"를 한 번 거쳐야 한다.
  const { data: allRows, error: allError } = await supabase
    .from("foods")
    .select("brand_id, source_conflicts")
    .is("published_at", null)
    .not("protein_pct", "is", null);
  if (allError) throw new Error(allError.message);

  const counts = new Map<number, { pending: number; conflicts: number }>();
  for (const row of allRows ?? []) {
    const entry = counts.get(row.brand_id) ?? { conflicts: 0, pending: 0 };
    entry.pending += 1;
    if (
      Array.isArray(row.source_conflicts) &&
      row.source_conflicts.length > 0
    ) {
      entry.conflicts += 1;
    }
    counts.set(row.brand_id, entry);
  }

  return {
    brands: (brandRows ?? []).map((brand) => ({
      conflicts: counts.get(brand.id)?.conflicts ?? 0,
      country: brand.country,
      id: brand.id,
      koName: brand.ko_name,
      name: brand.name,
      pending: counts.get(brand.id)?.pending ?? 0,
    })),
    foods,
  };
}
