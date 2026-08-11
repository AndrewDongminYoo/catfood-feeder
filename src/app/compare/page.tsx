import Link from "next/link";
import type { Route } from "next";
import { FoodComparison } from "@/components/food-comparison";
import { getComparisonFoods } from "@/lib/catalog";

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
  // ids가 없으면 아무것도 고르지 않는다. 예전에는 카탈로그 상위 2개로 폴백해서
  // 사용자가 선택하지 않은 제품을 비교 결과처럼 보여줬다.
  const selected =
    parsedIds.length > 0 ? await getComparisonFoods(parsedIds) : [];

  return (
    <main className="wide">
      <header className="hd">
        <p>
          <Link href={"/foods" as Route}>← 카탈로그</Link>
        </p>
        <h1>사료 비교</h1>
        <p>두 제품의 보증성분, 열량비, 출처 상태를 나란히 봅니다.</p>
      </header>

      <FoodComparison foods={selected} />
    </main>
  );
}
