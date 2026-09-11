"use client";

import { useState } from "react";
import type { PendingTranscript } from "@/lib/label-transcripts";
import type { SourceKind } from "@/lib/source-collection";
import {
  evidenceApplyResponseSchema,
  ingredientApplyResponseSchema,
} from "@/lib/source-apply";

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
  const [sourceKinds, setSourceKinds] = useState<Record<number, SourceKind>>(
    {},
  );
  const [ingredientExcerpts, setIngredientExcerpts] = useState<
    Record<number, string>
  >({});
  const [ingredientNames, setIngredientNames] = useState<
    Record<number, string>
  >({});
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
    const editedIngredientExcerpt =
      item.ingredientDraft === null
        ? null
        : (ingredientExcerpts[item.runId] ?? item.ingredientDraft.excerpt);
    const transcript = text[item.runId] ?? item.transcript;
    const capturedText =
      item.ingredientDraft !== null &&
      editedIngredientExcerpt !== null &&
      editedIngredientExcerpt !== item.ingredientDraft.excerpt &&
      transcript.includes(item.ingredientDraft.excerpt)
        ? transcript.replace(
            item.ingredientDraft.excerpt,
            editedIngredientExcerpt,
          )
        : transcript;
    const sourceKind = sourceKinds[item.runId] ?? item.sourceKind;
    const ingredientDraft =
      item.ingredientDraft === null
        ? null
        : {
            excerpt: editedIngredientExcerpt,
            ingredients: (
              ingredientNames[item.runId] ??
              item.ingredientDraft.ingredients
                .map((ingredient) => ingredient.name)
                .join("\n")
            )
              .split("\n")
              .map((name) => name.trim())
              .filter((name) => name.length > 0)
              .map((name, index) => ({ name, position: index + 1 })),
          };
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
            kind: sourceKind,
            url: item.productPageUrl,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      const source: unknown = await registered.json();
      let sourceId: number | undefined;
      if (registered.status === 409) {
        const currentResponse = await fetch(
          `/api/foods/${String(item.foodId)}/sources`,
        );
        const currentBody: unknown = await currentResponse.json();
        if (!currentResponse.ok)
          throw new Error(
            (currentBody as { error?: string }).error ?? "현재 출처 확인 실패",
          );
        const currentSources = (
          currentBody as {
            sources?: readonly {
              id?: unknown;
              kind?: unknown;
              url?: unknown;
            }[];
          }
        ).sources;
        const current = currentSources?.find(
          (candidate) => candidate.url === item.productPageUrl,
        );
        if (typeof current?.id !== "number")
          throw new Error("같은 URL의 현재 출처를 확인하지 못했습니다.");
        if (current.kind !== sourceKind)
          throw new Error(
            "같은 URL의 현재 출처 종류가 달라 교체하지 않았습니다.",
          );
        sourceId = current.id;
      } else if (!registered.ok) {
        throw new Error(
          (source as { error?: string }).error ?? "출처 등록 실패",
        );
      } else {
        sourceId = (source as { source?: { id?: number } }).source?.id;
        if (typeof sourceId === "number") strandedSourceId = sourceId;
      }
      if (typeof sourceId !== "number") throw new Error("source.id 없음");

      const counts = { applied: 0, conflict: 0, skipped: 0 };
      const verifiedNutrientsSkipped =
        item.dataVerifiedAt === null ? 0 : item.values.length;
      let nutrientFailure: string | null = null;
      if (item.values.length > 0 && item.dataVerifiedAt === null) {
        try {
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

          const parsedResults = evidenceApplyResponseSchema.safeParse(result);
          if (!parsedResults.success)
            throw new Error("근거 적용 결과 형식을 확인하지 못했습니다.");
          for (const r of parsedResults.data.results) counts[r.status]++;
          if (counts.applied > 0) strandedSourceId = null;
        } catch (error: unknown) {
          nutrientFailure =
            error instanceof Error ? error.message : "근거 적용 실패";
        }
      }

      let ingredientStatus: "applied" | "conflict" | "skipped" | null = null;
      let ingredientFailure: string | null = null;
      if (ingredientDraft !== null) {
        try {
          const applied = await fetch(
            `/api/foods/${String(item.foodId)}/sources/ingredients`,
            {
              body: JSON.stringify({
                ...ingredientDraft,
                sourceId,
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            },
          );
          const result: unknown = await applied.json();
          if (!applied.ok)
            throw new Error(
              (result as { error?: string }).error ?? "원재료 적용 실패",
            );
          const parsedResult = ingredientApplyResponseSchema.safeParse(result);
          if (!parsedResult.success)
            throw new Error("원재료 적용 결과 형식을 확인하지 못했습니다.");
          ingredientStatus = parsedResult.data.result.status;
          if (ingredientStatus === "applied") strandedSourceId = null;
        } catch (error: unknown) {
          ingredientFailure =
            error instanceof Error ? error.message : "원재료 적용 실패";
        }
      }

      if (counts.applied === 0 && ingredientStatus !== "applied") {
        const noApplyDetails: string[] = [];
        if (counts.skipped > 0)
          noApplyDetails.push(`영양소 건너뜀 ${String(counts.skipped)}`);
        if (counts.conflict > 0)
          noApplyDetails.push(`영양소 충돌 ${String(counts.conflict)}`);
        if (nutrientFailure !== null)
          noApplyDetails.push(`영양소 실패: ${nutrientFailure}`);
        if (ingredientStatus === "skipped")
          noApplyDetails.push("원재료 건너뜀");
        if (ingredientStatus === "conflict") noApplyDetails.push("원재료 충돌");
        if (ingredientFailure !== null)
          noApplyDetails.push(`원재료 실패: ${ingredientFailure}`);
        if (noApplyDetails.length === 0) noApplyDetails.push("적용 결과 없음");
        throw new Error(
          `적용된 근거가 없습니다 (${noApplyDetails.join(", ")})`,
        );
      }

      await closeRun(item.runId, "applied");
      const details: string[] = [];
      if (counts.applied > 0)
        details.push(`영양소 적용 ${String(counts.applied)}`);
      if (counts.skipped > 0)
        details.push(`영양소 건너뜀 ${String(counts.skipped)}`);
      if (counts.conflict > 0)
        details.push(`영양소 충돌 ${String(counts.conflict)}`);
      if (verifiedNutrientsSkipped > 0)
        details.push(
          `검증된 영양소 ${String(verifiedNutrientsSkipped)}건 건너뜀`,
        );
      if (nutrientFailure !== null)
        details.push(`영양소 실패: ${nutrientFailure}`);
      if (ingredientStatus === "applied") details.push("원재료 적용");
      if (ingredientStatus === "skipped") details.push("원재료 건너뜀");
      if (ingredientStatus === "conflict") details.push("원재료 충돌");
      if (ingredientFailure !== null)
        details.push(`원재료 실패: ${ingredientFailure}`);
      setLog((lines) => [
        ...lines,
        `✓ ${item.productName}${details.length === 0 ? "" : ` — ${details.join(", ")}`}`,
      ]);
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
              <label>
                출처 종류
                <select
                  onChange={(event) =>
                    setSourceKinds((prev) => ({
                      ...prev,
                      [item.runId]: event.target.value as SourceKind,
                    }))
                  }
                  value={sourceKinds[item.runId] ?? item.sourceKind}
                >
                  <option value="manufacturer">제조사</option>
                  <option value="kr_label">국내 라벨</option>
                </select>
              </label>
              <label htmlFor={`transcript-${String(item.runId)}`}>
                전사 원문
              </label>
              <textarea
                id={`transcript-${String(item.runId)}`}
                onChange={(event) =>
                  setText((prev) => ({
                    ...prev,
                    [item.runId]: event.target.value,
                  }))
                }
                rows={10}
                value={text[item.runId] ?? item.transcript}
              />
              {item.ingredientDraft !== null && (
                <>
                  <label htmlFor={`ingredient-excerpt-${String(item.runId)}`}>
                    원재료 원문
                  </label>
                  <textarea
                    className="sm"
                    id={`ingredient-excerpt-${String(item.runId)}`}
                    onChange={(event) =>
                      setIngredientExcerpts((prev) => ({
                        ...prev,
                        [item.runId]: event.target.value,
                      }))
                    }
                    value={
                      ingredientExcerpts[item.runId] ??
                      item.ingredientDraft.excerpt
                    }
                  />
                  <label htmlFor={`ingredient-names-${String(item.runId)}`}>
                    원재료 목록 (한 줄에 하나)
                  </label>
                  <textarea
                    className="sm"
                    id={`ingredient-names-${String(item.runId)}`}
                    onChange={(event) =>
                      setIngredientNames((prev) => ({
                        ...prev,
                        [item.runId]: event.target.value,
                      }))
                    }
                    value={
                      ingredientNames[item.runId] ??
                      item.ingredientDraft.ingredients
                        .map((ingredient) => ingredient.name)
                        .join("\n")
                    }
                  />
                </>
              )}
              {item.values.length > 0 && (
                <ul>
                  {item.values.map((value, index) => (
                    // 표가 두 번 인쇄되면 같은 nutrientKey가 두 번 올 수 있다 — 그것을
                    // key로 쓰면 React가 둘을 같은 항목으로 접어 중복을 화면에서
                    // 감춘다. 승인 전에 사람이 봐야 할 신호다.
                    <li key={`${value.nutrientKey}-${String(index)}`}>
                      {value.nutrientKey} = {value.value} —{" "}
                      <em>{value.excerpt}</em>
                    </li>
                  ))}
                </ul>
              )}
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
