import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { FeedingForm } from "@/components/feeding-form";
import { getFoods } from "@/lib/catalog";
import { getFeedingDashboard } from "@/lib/feeding";

export default async function FeedingPage() {
  const [{ user, cats, insights }, foods] = await Promise.all([
    getFeedingDashboard(),
    getFoods(),
  ]);

  return (
    <main className="wide">
      <header className="hd">
        <p>
          <Link href="/">← 홈</Link>
        </p>
        <h1>급여 기록</h1>
        <p>제품 교체 주기와 영양·열량 급변을 기록합니다.</p>
      </header>

      {!user ? (
        <section className="card">
          <AuthForm />
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
