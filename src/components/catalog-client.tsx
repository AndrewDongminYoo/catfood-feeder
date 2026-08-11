"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
import type { FoodWithBrand } from "@/lib/catalog";
import { formatKcalValue, formatPct } from "@/lib/format";

export function CatalogClient({ foods }: { foods: FoodWithBrand[] }) {
  const [query, setQuery] = useState("");
  const [grainFree, setGrainFree] = useState(false);
  const [highProtein, setHighProtein] = useState(false);
  const [normalCaP, setNormalCaP] = useState(false);
  const [cookingMethod, setCookingMethod] = useState("");
  const [sort, setSort] = useState("name");
  const [selected, setSelected] = useState<number[]>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return foods
      .filter((food) => {
        const name =
          `${food.brands?.name ?? ""} ${food.product_name}`.toLowerCase();
        if (q && !name.includes(q)) return false;
        if (grainFree && !food.grain_free) return false;
        if (highProtein && (food.protein_pct ?? 0) < 35) return false;
        if (cookingMethod && food.cooking_method !== cookingMethod)
          return false;
        if (normalCaP && (food.ca_p_ratio === null || food.ca_p_ratio < 1.0)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === "protein-energy") {
          return (b.energy_p_pct ?? 0) - (a.energy_p_pct ?? 0);
        }
        if (sort === "protein") {
          return (b.protein_pct ?? 0) - (a.protein_pct ?? 0);
        }
        return `${a.brands?.name ?? ""} ${a.product_name}`.localeCompare(
          `${b.brands?.name ?? ""} ${b.product_name}`,
        );
      });
  }, [cookingMethod, foods, grainFree, highProtein, normalCaP, query, sort]);

  function toggleSelected(id: number) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id].slice(-2);
    });
  }

  const hasQuery = query.trim().length > 0;
  const resultHeading = hasQuery ? "검색 결과" : "전체 카탈로그";
  const resultDescription = hasQuery
    ? `${filtered.length}개 제품이 검색되었습니다.`
    : "등록된 제품을 둘러보며 익숙하지 않았던 사료도 확인해 보세요.";

  return (
    <>
      <section className="tool-panel">
        <section
          aria-label="사료 검색"
          className="catalog-search"
          role="search"
        >
          <label htmlFor="food-search">찾고 있는 사료를 검색하세요</label>
          <input
            autoFocus
            className="search"
            id="food-search"
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="브랜드 또는 제품명"
            type="search"
            value={query}
          />
        </section>
        <details className="catalog-filters">
          <summary>더 좁혀 보기</summary>
          <div className="catalog-filter-content">
            <div className="checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={grainFree}
                  onChange={(event) => setGrainFree(event.target.checked)}
                />
                그레인프리
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={highProtein}
                  onChange={(event) => setHighProtein(event.target.checked)}
                />
                단백질 35%+
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={normalCaP}
                  onChange={(event) => setNormalCaP(event.target.checked)}
                />
                Ca:P 1.0+
              </label>
            </div>
            <div className="frow">
              <label>
                제조법
                <select
                  value={cookingMethod}
                  onChange={(event) => setCookingMethod(event.target.value)}
                >
                  <option value="">전체</option>
                  <option value="extrusion">익스트루전</option>
                  <option value="baked">오븐 베이크</option>
                  <option value="freeze_dried">동결건조</option>
                  <option value="dried">건조</option>
                </select>
              </label>
              <label>
                정렬
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="name">이름순</option>
                  <option value="protein">단백질 높은순</option>
                  <option value="protein-energy">단백질 열량비 높은순</option>
                </select>
              </label>
            </div>
          </div>
        </details>
        {/* pointer-events:none은 마우스만 막는다. aria-disabled와 tabIndex가 없으면
            키보드로 탭이 닿고 Enter로 "#"까지 이동한다. */}
        <Link
          aria-disabled={selected.length !== 2}
          className={`compare-link${selected.length === 2 ? "" : " disabled"}`}
          href={
            (selected.length === 2
              ? `/compare?ids=${selected.join(",")}`
              : "#") as Route
          }
          tabIndex={selected.length === 2 ? undefined : -1}
        >
          선택한 두 제품 비교
        </Link>
      </section>

      <section
        aria-labelledby="catalog-results-heading"
        className="catalog-results"
      >
        <header className="catalog-results-header">
          <h2 id="catalog-results-heading">{resultHeading}</h2>
          <p>{resultDescription}</p>
        </header>
        <div className="catalog-grid">
          {filtered.map((food) => (
            <article className="food-card" key={food.id}>
              <div>
                <p className="eyebrow">
                  {food.brands?.name ?? "브랜드 미기록"}
                </p>
                <h3>
                  <Link href={`/foods/${food.id}` as Route}>
                    {food.product_name}
                  </Link>
                </h3>
              </div>
              {/* 단위를 라벨로 올린다. 값에 "kcal/kg"이 붙으면 셋 중 하나만 두 줄이
                  되어 세 값의 baseline이 어긋난다. */}
              <div className="metric-row">
                <Metric label="단백질" value={formatPct(food.protein_pct)} />
                <Metric label="탄수" value={formatPct(food.carb_pct)} />
                <Metric
                  label="열량 kcal/kg"
                  value={formatKcalValue(food.kcal_per_kg)}
                />
              </div>
              <div className="chips">
                {food.grain_free && <span>grain free</span>}
                {food.has_probiotics && <span>probiotics</span>}
                {food.cooking_method && <span>{food.cooking_method}</span>}
                {(food.recalls?.length ?? 0) > 0 && <span>recall history</span>}
              </div>
              <button
                aria-pressed={selected.includes(food.id)}
                className="ghost"
                onClick={() => toggleSelected(food.id)}
              >
                {selected.includes(food.id) ? "비교 해제" : "비교 선택"}
              </button>
            </article>
          ))}
          {filtered.length === 0 && (
            <div className="empty">조건에 맞는 사료가 없습니다.</div>
          )}
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
