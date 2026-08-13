import Link from "next/link";
import { RecallHistory } from "@/components/recall-history";
import { getRecalls } from "@/lib/catalog";

export const revalidate = 3600;

export default async function RecallsPage() {
  const recalls = await getRecalls();

  return (
    <main className="wrap">
      <header className="hd">
        <p>
          <Link href="/">← 홈</Link>
        </p>
        <h1>리콜 이력</h1>
        <p>openFDA Food Enforcement 기반 주간 동기화 대상입니다.</p>
      </header>
      <section className="card">
        <p className="notice">
          이 화면은 실시간 경보가 아니라 공개 리콜 이력 조회입니다. openFDA
          Enforcement Reports는 분류 후 상태가 갱신되지 않을 수 있습니다.
        </p>
      </section>
      <RecallHistory
        emptyMessage="동기화된 리콜 이력이 없습니다."
        recalls={recalls}
      />
    </main>
  );
}
