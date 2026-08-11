import type { RecallSummary } from "@/lib/catalog";

export function RecallHistory({
  recalls,
}: {
  recalls: readonly RecallSummary[];
}) {
  if (recalls.length === 0) {
    return <p className="muted">연결된 리콜 이력이 없습니다.</p>;
  }

  return (
    <div className="recall-list">
      {recalls.map((recall) => (
        <a href={recall.source_url} key={recall.id}>
          <strong>{recall.classification ?? "분류 미기록"}</strong>
          <span>{recall.reason ?? recall.recalling_firm ?? "사유 미기록"}</span>
          <span>출처: {recall.source}</span>
          <span>
            {recall.affected_lots
              ? `대상 로트: ${recall.affected_lots}`
              : "대상 로트 미기록"}
          </span>
          <em>{recall.recall_date ?? "날짜 미기록"}</em>
        </a>
      ))}
    </div>
  );
}
