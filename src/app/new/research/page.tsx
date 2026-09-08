import { SourceResearchClient } from "@/components/source-research-client";
import { authorizeHumanCurator } from "@/lib/admin-auth";
import { loadResearchExceptions } from "@/lib/research-exceptions";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const authorization = await authorizeHumanCurator();
  if (authorization.kind === "denied") {
    if (authorization.status === 401) {
      redirect(`/auth/login?next=${encodeURIComponent("/new/research")}`);
    }
    notFound();
  }

  const exceptions = await loadResearchExceptions();

  return (
    <main className="wide">
      <header className="hd">
        <h1>출처 기반 사료 조사</h1>
        <p>수집 원문과 근거를 확인한 뒤에만 Draft 값을 적용합니다.</p>
      </header>
      <SourceResearchClient />
      <section className="card">
        <h2>조사 예외 큐</h2>
        <p>
          수집 실패, 경합, 근거 거절, 제안 형식 오류, 실행 오류를 최근 실행부터
          표시합니다.
        </p>
        {exceptions.length === 0 ? (
          <p>확인할 조사 예외가 없습니다.</p>
        ) : (
          <table className="review-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>사료</th>
                <th>상태</th>
                <th>원인</th>
                <th>시각</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>
                    {item.brandName ? `${item.brandName} · ` : ""}
                    {item.productName} (#{item.foodId})
                  </td>
                  <td>{item.status}</td>
                  <td>{item.reason}</td>
                  <td>
                    <time dateTime={item.createdAt}>{item.createdAt}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
