import Link from "next/link";
import type { Route } from "next";
import { getComparisonFoods, getFoods } from "@/lib/catalog";
import { formatKcal, formatPct } from "@/lib/format";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const parsedIds = (ids ?? "")
    .split(",")
    .map((id) => Number(id))
    .filter(Boolean)
    .slice(0, 2);
  const foods =
    parsedIds.length > 0
      ? await getComparisonFoods(parsedIds)
      : await getFoods();
  const selected = foods.slice(0, 2);

  return (
    <main className="wide">
      <header className="hd">
        <p>
          <Link href={"/foods" as Route}>← 카탈로그</Link>
        </p>
        <h1>사료 비교</h1>
        <p>두 제품의 보증성분, 열량비, 출처 상태를 나란히 봅니다.</p>
      </header>

      <section className="compare-grid">
        {selected.map((food) => (
          <article className="food-card" key={food.id}>
            <p className="eyebrow">{food.brands?.name ?? "브랜드 미기록"}</p>
            <h2>{food.product_name}</h2>
            <div className="data-table compact">
              <Row label="단백질" value={formatPct(food.protein_pct)} />
              <Row label="지방" value={formatPct(food.fat_pct)} />
              <Row label="탄수" value={formatPct(food.carb_pct)} />
              <Row label="단백질 열량비" value={formatPct(food.energy_p_pct)} />
              <Row label="지방 열량비" value={formatPct(food.energy_f_pct)} />
              <Row label="탄수 열량비" value={formatPct(food.energy_c_pct)} />
              <Row label="Ca:P" value={food.ca_p_ratio?.toString() ?? "—"} />
              <Row label="열량" value={formatKcal(food.kcal_per_kg)} />
            </div>
          </article>
        ))}
      </section>
      {selected.length < 2 && (
        <p className="empty">카탈로그에서 비교할 제품 두 개를 선택하세요.</p>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
