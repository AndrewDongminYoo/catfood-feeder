import Link from "next/link";
import { CatalogClient } from "@/components/catalog-client";
import { getFoods } from "@/lib/catalog";

export const revalidate = 3600;

export default async function FoodsPage() {
  const foods = await getFoods();

  return (
    <main className="wide">
      <header className="hd">
        <p>
          <Link href="/">← 홈</Link>
        </p>
        <h1>사료 카탈로그</h1>
        <p>성분 출처가 분리된 수입 건사료 데이터입니다.</p>
      </header>
      <CatalogClient foods={foods} />
    </main>
  );
}
