import type { RecallSummary } from "@/lib/catalog";

export function RecallHistory({
  recalls,
  emptyMessage = "연결된 리콜 이력이 없습니다.",
}: {
  recalls: readonly RecallSummary[];
  emptyMessage?: string;
}) {
  if (recalls.length === 0) {
    return <p className="muted">{emptyMessage}</p>;
  }

  return (
    <div className="recall-list">
      {recalls.map((recall) => (
        <a href={recall.source_url} key={recall.id}>
          <span className="evidence-state" data-tone="unknown">
            {recall.scope === "product"
              ? "제품 연결 이력"
              : recall.scope === "brand"
                ? "브랜드 범위 이력"
                : "카탈로그 미연결 이력"}
          </span>
          <strong>{recall.classification ?? "분류 미기록"}</strong>
          <span>{recall.reason ?? recall.recalling_firm ?? "사유 미기록"}</span>
          <span>출처: {recall.source}</span>
          <span>
            {recall.affected_lots
              ? `대상 로트: ${recall.affected_lots}`
              : "대상 로트 미기록"}
          </span>
          {recall.scope === "brand" && (
            <span>이 제품·로트의 해당 여부는 확인되지 않았습니다.</span>
          )}
          {recall.scope === "unlinked" && (
            <span>카탈로그 제품·브랜드와의 연결이 확인되지 않았습니다.</span>
          )}
          <em>{recall.recall_date ?? "날짜 미기록"}</em>
        </a>
      ))}
    </div>
  );
}
