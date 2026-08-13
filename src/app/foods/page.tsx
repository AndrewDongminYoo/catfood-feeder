import { CatalogClient } from "@/components/catalog-client";
import { getFoods } from "@/lib/catalog";

export const revalidate = 3600;

export default async function FoodsPage({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string | string[] }>;
}) {
  const foods = await getFoods();
  const { compare } = await searchParams;
  const normalizedCompare = Array.isArray(compare) ? compare[0] : compare;
  const parsedCompareId = Number(normalizedCompare);
  const initialSelectedId =
    normalizedCompare?.trim() !== "" &&
    Number.isSafeInteger(parsedCompareId) &&
    parsedCompareId >= 0
      ? parsedCompareId
      : undefined;

  return (
    <main className="wide">
      <header className="hd">
        <h1>사료 카탈로그</h1>
        <p>
          찾고 있는 제품을 먼저 검색하세요. 필요하면 카탈로그를 둘러보고 두
          제품의 차이를 확인할 수 있습니다.
        </p>
      </header>
      <CatalogClient foods={foods} initialSelectedId={initialSelectedId} />
    </main>
  );
}
