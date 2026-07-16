import { SourceResearchClient } from "@/components/source-research-client";

export default function ResearchPage() {
  return (
    <main className="wrap">
      <header className="hd">
        <h1>출처 기반 사료 조사</h1>
        <p>수집 원문과 근거를 확인한 뒤에만 Draft 값을 적용합니다.</p>
      </header>
      <SourceResearchClient />
    </main>
  );
}
