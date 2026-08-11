import { CatalogClient } from "@/components/catalog-client";
import { getFoods } from "@/lib/catalog";

export const revalidate = 3600;

export default async function FoodsPage() {
  const foods = await getFoods();

  return (
    <main className="wide">
      <header className="hd">
        <h1>사료 카탈로그</h1>
        <p>
          찾고 있는 제품을 먼저 검색하세요. 필요하면 카탈로그를 둘러보고 두
          제품의 차이를 확인할 수 있습니다.
        </p>
      </header>
      <CatalogClient foods={foods} />
    </main>
  );
}
