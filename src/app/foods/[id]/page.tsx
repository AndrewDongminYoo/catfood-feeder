import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { getFood } from "@/lib/catalog";
import { NUTRIENT_FIELDS } from "@/lib/domain";
import { formatKcal, formatPct, sourceLabel } from "@/lib/format";

export const revalidate = 3600;

export default async function FoodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const food = await getFood(Number(id));
  if (!food) notFound();

  return (
    <main className="wrap">
      <header className="hd">
        <p>
          <Link href={"/foods" as Route}>← 카탈로그</Link>
        </p>
        <h1>{food.product_name}</h1>
        <p>
          {food.brands?.name ?? "브랜드 미기록"} · 라벨 보증치 기반 · 출처별
          수치 분리
        </p>
      </header>

      <section className="card">
        <div className="derived">
          <Cell label="단백질" value={formatPct(food.protein_pct)} />
          <Cell label="지방" value={formatPct(food.fat_pct)} />
          <Cell label="탄수" value={formatPct(food.carb_pct)} />
          <Cell label="Ca:P" value={food.ca_p_ratio?.toString() ?? "—"} />
          <Cell label="열량" value={formatKcal(food.kcal_per_kg)} />
        </div>
      </section>

      <section className="card">
        <h2>성분 출처</h2>
        <div className="data-table">
          {NUTRIENT_FIELDS.map(([key, label]) => {
            const value =
              key === "kcal_per_kg"
                ? formatKcal(food[key])
                : formatPct(food[key]);
            return (
              <div key={key}>
                <span>{label}</span>
                <strong>{value}</strong>
                <em>{sourceLabel(food.nutrient_sources[key])}</em>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>원료</h2>
        <div className="chips">
          {food.ingredients.map((ingredient, index) => (
            <span key={`${ingredient.name}-${index}`}>
              {ingredient.name}
              {ingredient.pct !== null ? ` ${ingredient.pct}%` : ""}
            </span>
          ))}
          {food.ingredients.length === 0 && <span>원료 미기록</span>}
        </div>
      </section>

      <section className="card">
        <h2>리콜 이력</h2>
        {(food.recalls ?? []).length === 0 ? (
          <p className="muted">연결된 리콜 이력이 없습니다.</p>
        ) : (
          <div className="recall-list">
            {(food.recalls ?? []).map((recall) => (
              <a href={recall.source_url} key={recall.id}>
                <strong>{recall.classification ?? "분류 미기록"}</strong>
                <span>{recall.reason ?? recall.recalling_firm}</span>
                <em>{recall.recall_date ?? "날짜 미기록"}</em>
              </a>
            ))}
          </div>
        )}
        <p className="notice">
          리콜 정보는 이력 참고용입니다. 실시간 경보 또는 안전성 단정으로
          사용하지 않습니다.
        </p>
      </section>
    </main>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="dcell">
      <div className="dlabel">{label}</div>
      <div className="dval">{value}</div>
    </div>
  );
}
