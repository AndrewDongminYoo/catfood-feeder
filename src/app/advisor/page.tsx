import Link from "next/link";
import type { Route } from "next";
import {
  AdvisorResults,
  type AdvisorViewState,
} from "@/components/advisor-results";
import { findAdvisorCandidates, parseAdvisorSearchParams } from "@/lib/advisor";
import { getAdvisorCatalog } from "@/lib/catalog";

export const revalidate = 3600;

type AdvisorPageSearchParams = {
  current?: string | string[];
  kcalDelta?: string | string[];
  cookingMethod?: string | string[];
  declaredCarb?: string | string[];
};

function viewState(
  catalog: Awaited<ReturnType<typeof getAdvisorCatalog>>,
  params: AdvisorPageSearchParams,
): {
  state: AdvisorViewState;
  query: ReturnType<typeof parseAdvisorSearchParams> | null;
} {
  if (!catalog.available) {
    return {
      query: null,
      state: { kind: "data_unavailable", reason: catalog.reason },
    };
  }
  if (params.current === undefined) {
    return { query: null, state: { kind: "empty" } };
  }

  const parsed = parseAdvisorSearchParams(params);
  if (!parsed.ok) {
    return { query: parsed, state: { kind: "invalid_query" } };
  }

  const selection = findAdvisorCandidates(catalog, parsed.query);
  if (selection.kind === "current_food_not_found") {
    return { query: parsed, state: { kind: "current_food_not_found" } };
  }

  const currentFood = catalog.foods.find(
    (food) => food.id === parsed.query.currentFoodId,
  );
  if (!currentFood) {
    return { query: parsed, state: { kind: "current_food_not_found" } };
  }

  return {
    query: parsed,
    state: { currentFood, kind: "ready", selection },
  };
}

export default async function AdvisorPage({
  searchParams,
}: {
  searchParams: Promise<AdvisorPageSearchParams>;
}) {
  const params = await searchParams;
  const catalog = await getAdvisorCatalog();
  const view = viewState(catalog, params);
  const query = view.query?.ok ? view.query.query : null;
  const foods = catalog.available ? catalog.foods : [];

  return (
    <main className="wide">
      <header className="hd advisor-heading">
        <p>
          <Link href={"/foods" as Route}>← 카탈로그</Link>
        </p>
        <p className="eyebrow">근거 기반 사료 탐색 v0</p>
        <h1>다음 사료 후보 찾기</h1>
        <p>
          현재 사료와 확인 가능한 조건을 고르면 열량 차이가 가까운 후보를 최대
          3개까지 보여 줍니다.
        </p>
      </header>

      <form action="/advisor" className="card advisor-form" method="get">
        <div className="advisor-form-heading">
          <h2>비교 조건</h2>
          <p>선택한 조건은 주소에 남아 같은 결과를 다시 확인할 수 있습니다.</p>
        </div>
        <div className="advisor-form-grid">
          <label>
            현재 사료
            <select
              defaultValue={query ? String(query.currentFoodId) : ""}
              disabled={!catalog.available}
              name="current"
              required
            >
              <option value="">선택하세요</option>
              {foods.map((food) => (
                <option key={food.id} value={food.id}>
                  {food.brands?.name ?? "브랜드 미확인"} · {food.product_name}
                </option>
              ))}
            </select>
          </label>

          <label>
            허용할 열량 차이
            <select
              defaultValue={query?.maxKcalDeltaPct ?? ""}
              disabled={!catalog.available}
              name="kcalDelta"
            >
              <option value="">제한 없음</option>
              <option value="5">5% 이내</option>
              <option value="10">10% 이내</option>
              <option value="15">15% 이내</option>
            </select>
          </label>

          <label>
            제조 방식
            <select
              defaultValue={query?.cookingMethod ?? ""}
              disabled={!catalog.available}
              name="cookingMethod"
            >
              <option value="">제한 없음</option>
              <option value="extrusion">익스트루전</option>
              <option value="baked">베이크드</option>
              <option value="freeze_dried">동결건조</option>
              <option value="dried">건조</option>
            </select>
          </label>

          <label className="check advisor-check">
            <input
              defaultChecked={query?.requireDeclaredCarb ?? false}
              disabled={!catalog.available}
              name="declaredCarb"
              type="checkbox"
              value="1"
            />
            표기 탄수화물이 있는 제품만
          </label>
        </div>
        <button className="primary" disabled={!catalog.available} type="submit">
          후보 확인하기
        </button>
      </form>

      <AdvisorResults state={view.state} />
    </main>
  );
}
