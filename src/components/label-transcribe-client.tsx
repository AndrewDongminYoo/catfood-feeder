"use client";

import { useState } from "react";
import type { PendingTranscript } from "@/lib/label-transcripts";

/**
 * 승인은 브라우저의 운영자 세션에서 나간다. 그래야 `manual` 이 "사람이 읽고 옮겨
 * 적었다"는 뜻을 유지한다 — 자동화 자격 증명은 그 경로에서 403 을 받는다.
 */
export function LabelTranscribeClient({
  initialTranscripts,
}: {
  readonly initialTranscripts: readonly PendingTranscript[];
}) {
  const [items, setItems] = useState(initialTranscripts);
  const [text, setText] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<readonly string[]>([]);

  async function reload() {
    const response = await fetch("/api/foods/transcripts");
    if (!response.ok) return;
    const data: unknown = await response.json();
    const next = (data as { transcripts?: PendingTranscript[] }).transcripts;
    if (next) setItems(next);
  }

  async function closeRun(runId: number, status: "applied" | "rejected") {
    const response = await fetch(`/api/foods/transcripts/${String(runId)}`, {
      body: JSON.stringify({ status }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      throw new Error(
        (body as { error?: string } | null)?.error ?? "제안 상태 변경 실패",
      );
    }
  }

  async function approve(item: PendingTranscript) {
    setBusy(true);
    const capturedText = text[item.runId] ?? item.transcript;
    // 출처 등록 뒤, 근거 적용이 끝나기 전까지의 모든 실패(9개 초과, validate()의
    // 배치 거절, 편집으로 어긋난 excerpt 등 원인은 다양하다)는 근거 없는 manual
    // 출처를 남긴다. release-stranded.mjs는 사료 단위로 오래됨을 판단해 이런
    // 사료를 정리하지 못한다 — 이미 다른 출처의 근거가 붙어 있으면 그쪽 근거를
    // 보고 "최신"이라 여긴다. 그래서 이 id를 들고 있다가 실패 로그에 실어 사람이
    // 직접 지우게 한다.
    let strandedSourceId: number | null = null;
    try {
      const registered = await fetch(
        `/api/foods/${String(item.foodId)}/sources`,
        {
          body: JSON.stringify({
            captureMethod: "manual",
            capturedText,
            kind: "kr_label",
            url: item.productPageUrl,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      const source: unknown = await registered.json();
      if (!registered.ok)
        throw new Error(
          (source as { error?: string }).error ?? "출처 등록 실패",
        );

      const sourceId = (source as { source?: { id?: number } }).source?.id;
      if (typeof sourceId !== "number") throw new Error("source.id 없음");
      strandedSourceId = sourceId;

      const applied = await fetch(
        `/api/foods/${String(item.foodId)}/sources/apply`,
        {
          body: JSON.stringify({
            evidence: item.values.map((value) => ({ ...value, sourceId })),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      const result: unknown = await applied.json();
      if (!applied.ok)
        throw new Error(
          (result as { error?: string }).error ?? "근거 적용 실패",
        );
      strandedSourceId = null; // 근거가 붙었다 — 더는 미아 출처가 아니다.

      await closeRun(item.runId, "applied");
      setLog((lines) => [...lines, `✓ ${item.productName}`]);
      await reload();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "실패";
      const strandedNote =
        strandedSourceId === null
          ? ""
          : ` — 출처 #${strandedSourceId}는 등록됐지만 근거는 비었습니다. 직접 정리하세요.`;
      setLog((lines) => [
        ...lines,
        `✗ ${item.productName} — ${message}${strandedNote}`,
      ]);
    }
    setBusy(false);
  }

  async function skip(item: PendingTranscript) {
    setBusy(true);
    try {
      await closeRun(item.runId, "rejected");
      setLog((lines) => [...lines, `– ${item.productName} 건너뜀`]);
      await reload();
    } catch (error: unknown) {
      setLog((lines) => [
        ...lines,
        `✗ ${item.productName} — ${error instanceof Error ? error.message : "실패"}`,
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return <p className="muted">확인할 전사 제안이 없습니다.</p>;
  }

  return (
    <>
      <p className="muted">{items.length}건 대기</p>
      {items.map((item) => (
        <article className="panel" key={item.runId}>
          <h2>
            {item.brandName} · {item.productName}
          </h2>
          <div className="transcribe-grid">
            <div>
              {item.imageUrls.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element -- 외부 상세 이미지, 세로 비율 다양. next/image는 사이즈 고정을 요구해 원본 대조가 어려워진다.
                <img alt="" key={url} src={url} />
              ))}
            </div>
            <div>
              <textarea
                onChange={(event) =>
                  setText((prev) => ({
                    ...prev,
                    [item.runId]: event.target.value,
                  }))
                }
                rows={10}
                value={text[item.runId] ?? item.transcript}
              />
              <ul>
                {item.values.map((value) => (
                  <li key={value.nutrientKey}>
                    {value.nutrientKey} = {value.value} —{" "}
                    <em>{value.excerpt}</em>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="muted">출처 {item.productPageUrl}</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void approve(item)}
          >
            승인·등록
          </button>
          <button disabled={busy} onClick={() => void skip(item)}>
            건너뜀
          </button>
        </article>
      ))}
      {log.length > 0 && (
        <div className="panel" role="status">
          {log.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </>
  );
}
