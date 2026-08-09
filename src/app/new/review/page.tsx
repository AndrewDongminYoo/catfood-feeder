import { PublicationReviewClient } from "@/components/publication-review-client";
import { loadPublicationReview } from "@/lib/publication-review";

export default async function ReviewPage() {
  // 첫 목록은 서버에서 채운다. 클라이언트가 마운트 후 불러오면 로딩 깜빡임이 생기고,
  // effect 안의 setState가 연쇄 렌더를 유발한다.
  const initial = await loadPublicationReview(null);

  // 어드민 전용 화면이라 데스크톱 폭을 쓴다. 이 작업은 codex CLI와 함께 돌아가므로
  // 어차피 데스크톱이고, 모바일 폭에 맞추려 열을 접으면 비교해야 할 수치가 멀어진다.
  return (
    <main className="wide">
      <header className="hd">
        <h1>발행 검토</h1>
        <p>
          브랜드 단위로 근거가 붙은 Draft를 확인하고 발행합니다. 값을 다시
          입력하지 않으며, 조사와 근거 적용은 <code>/new/research</code>에서
          합니다.
        </p>
      </header>
      <section className="card">
        <PublicationReviewClient
          initialBrands={initial.brands}
          initialFoods={initial.foods}
        />
      </section>
    </main>
  );
}
