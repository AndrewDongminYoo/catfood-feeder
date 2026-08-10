import { LabelTranscribeClient } from "@/components/label-transcribe-client";
import { loadPendingTranscripts } from "@/lib/label-transcripts";

// loadPendingTranscripts는 supabase-js를 직접 호출해 Next의 fetch 캐시를 거치지
// 않는다 — 정적 페이지로 남으면 이 큐가 빌드 시점 스냅샷에 얼어붙어, 그 뒤에 올라온
// 제안이 재배포 전까지 화면에 나타나지 않는다. 요청마다 새로 읽는다.
export const dynamic = "force-dynamic";

export default async function TranscribePage() {
  const initial = await loadPendingTranscripts();

  return (
    <main className="wide">
      <header className="hd">
        <h1>라벨 전사 확인</h1>
        <p>
          상세 이미지에서 기계가 읽은 등록성분량입니다. 이미지와 대조해 맞으면
          승인하세요. 승인한 것만 <code>manual</code> 출처로 저장됩니다.
        </p>
      </header>
      <section className="card">
        <LabelTranscribeClient initialTranscripts={initial} />
      </section>
    </main>
  );
}
