import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { FoodDossier } from "@/components/food-dossier";
import { getFood } from "@/lib/catalog";

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
        <p>{food.brands?.name ?? "브랜드 미기록"} · 성분, 원재료, 근거 상태</p>
        <p>
          <Link href={`/foods?compare=${food.id}` as Route}>
            이 제품을 기준으로 다른 사료 비교하기
          </Link>
        </p>
      </header>
      <FoodDossier food={food} />
    </main>
  );
}
