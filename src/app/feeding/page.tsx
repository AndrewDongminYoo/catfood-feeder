import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { FeedingForm } from "@/components/feeding-form";
import { FeedingLogEditor } from "@/components/feeding-log-editor";
import { getFoods } from "@/lib/catalog";
import { getFeedingDashboard } from "@/lib/feeding";

export default async function FeedingPage() {
  const [{ user, cats, insights, configured, error }, foods] =
    await Promise.all([getFeedingDashboard(), getFoods()]);

  return (
    <main className="wide">
      <header className="hd">
        <p>
          <Link href="/">← 홈</Link>
        </p>
        <h1>급여 기록</h1>
        <p>제품 교체 주기와 영양·열량 급변을 기록합니다.</p>
      </header>

      {!configured ? (
        <section className="card">
          <h2>Supabase 설정 필요</h2>
          <p className="muted">
            급여 기록은 Supabase Auth와 개인 데이터 테이블이 필요합니다. Vercel
            환경변수에 NEXT_PUBLIC_SUPABASE_URL,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 설정한 뒤 다시 배포하세요.
          </p>
        </section>
      ) : !user ? (
        <section className="card">
          <AuthForm />
        </section>
      ) : error ? (
        <section className="card" role="alert">
          <h2>급여 기록을 표시할 수 없습니다</h2>
          <p className="muted">{error}</p>
          <Link className="ghost" href="/feeding">
            다시 시도
          </Link>
        </section>
      ) : (
        <>
          <form action="/auth/logout" method="post" className="inline-actions">
            <button className="ghost" type="submit">
              로그아웃
            </button>
          </form>
          <FeedingForm cats={cats} foods={foods} />
          <section className="card">
            <h2>교체 인사이트</h2>
            {insights.map((insight, index) => (
              <div className="insight" key={`${insight.catName}-${index}`}>
                <strong>{insight.catName}</strong>
                <span>
                  {insight.fromFood} → {insight.toFood}
                </span>
                <em>{insight.messages.join(" / ")}</em>
              </div>
            ))}
            {insights.length === 0 && (
              <p className="muted">
                아직 급변으로 볼 만한 교체 기록이 없습니다.
              </p>
            )}
          </section>
          <section className="catalog-grid">
            {cats.map((cat) => (
              <article className="food-card" key={cat.id}>
                <h2>{cat.name}</h2>
                <div className="timeline">
                  {cat.feeding_logs.map((log) => (
                    <div key={log.id}>
                      <strong>
                        {log.foods?.brands?.name} {log.foods?.product_name}
                      </strong>
                      <span>
                        {log.started_on} - {log.ended_on ?? "현재"}
                      </span>
                      <FeedingLogEditor foods={foods} log={log} />
                    </div>
                  ))}
                  {cat.feeding_logs.length === 0 && <span>기록 없음</span>}
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
