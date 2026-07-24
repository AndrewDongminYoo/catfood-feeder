type SourceTranscript = {
  readonly captured_at: string | null;
  readonly captured_text: string | null;
  readonly id: number;
  readonly kind: "manufacturer" | "kr_label";
  readonly url: string;
};

function sourceKindLabel(kind: SourceTranscript["kind"]) {
  return kind === "manufacturer" ? "제조사" : "국내 라벨";
}

function formatCapturedAt(capturedAt: string | null) {
  if (capturedAt === null) return "수집 시각 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(capturedAt));
}

export function SourceTranscriptPreviews({
  sources,
}: {
  readonly sources: readonly SourceTranscript[];
}) {
  return sources.map((source) => (
    <details className="source-preview panel" key={source.id}>
      <summary>{sourceKindLabel(source.kind)} 출처 원문</summary>
      <dl className="source-meta">
        <div>
          <dt>URL</dt>
          <dd>
            <a href={source.url} rel="noreferrer" target="_blank">
              {source.url}
            </a>
          </dd>
        </div>
        <div>
          <dt>수집 시각</dt>
          <dd>
            {source.captured_at === null ? (
              formatCapturedAt(source.captured_at)
            ) : (
              <time dateTime={source.captured_at}>
                {formatCapturedAt(source.captured_at)}
              </time>
            )}
          </dd>
        </div>
      </dl>
      <pre>{source.captured_text ?? "원문을 확인할 수 없습니다."}</pre>
    </details>
  ));
}
