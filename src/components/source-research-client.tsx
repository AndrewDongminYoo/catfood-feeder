"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import {
  conflictCandidates,
  evidenceApplyResponseSchema,
  evidenceCandidateSchema,
} from "@/lib/source-apply";
import { sourceCaptureResponseSchema } from "@/lib/source-capture-response";
import type { SourceContentStatus } from "@/lib/source-capture-response";
import { SourceCaptureForm } from "./source-capture-form";
import { SourcePublicationAction } from "./source-publication-action";
import { SourceTranscriptPreviews } from "./source-transcript-previews";

const sourceSchema = z.object({
  captured_at: z.string().nullable(),
  fetch_status: z.string(),
  id: z.number(),
  is_current: z.boolean(),
  kind: z.enum(["manufacturer", "kr_label"]),
  url: z.string(),
});
const foodSchema = z.object({
  brands: z.object({ name: z.string() }).nullable(),
  food_sources: z.array(sourceSchema),
  id: z.number(),
  product_name: z.string(),
});
const draftsSchema = z.object({ foods: z.array(foodSchema) });
// captured_text는 최대 256 KiB라 Draft 목록에 싣지 않고 선택한 사료만 지연 로드한다.
const transcriptSchema = z.object({
  captured_at: z.string().nullable(),
  captured_text: z.string().nullable(),
  id: z.number(),
  kind: z.enum(["manufacturer", "kr_label"]),
  url: z.string(),
});
const transcriptsSchema = z.object({ sources: z.array(transcriptSchema) });
type Transcript = z.infer<typeof transcriptSchema>;
type DraftFood = z.infer<typeof foodSchema>;
type Candidate = z.infer<typeof evidenceCandidateSchema>;

export function SourceResearchClient() {
  const [foods, setFoods] = useState<readonly DraftFood[]>([]);
  const [foodId, setFoodId] = useState("");
  const [kind, setKind] = useState<"manufacturer" | "kr_label">("manufacturer");
  const [url, setUrl] = useState("");
  const [manualText, setManualText] = useState("");
  const [candidates, setCandidates] = useState<readonly Candidate[]>([]);
  const [captureStatus, setCaptureStatus] =
    useState<SourceContentStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transcripts, setTranscripts] = useState<readonly Transcript[]>([]);

  const selected = foods.find((food) => String(food.id) === foodId) ?? null;
  const fetchedSources =
    selected?.food_sources.filter(
      (source) => source.is_current && source.fetch_status === "fetched",
    ) ?? [];

  useEffect(() => {
    void loadDrafts();
  }, []);

  // 선택이 바뀔 때만 재발화한다. 같은 사료에 출처를 새로 수집/적용한 경우는
  // registerSource/apply가 loadTranscripts를 직접 다시 호출한다.
  useEffect(() => {
    void loadTranscripts(foodId);
  }, [foodId]);

  async function loadTranscripts(id: number | string) {
    if (!id) {
      setTranscripts([]);
      return;
    }
    try {
      const response = await fetch(`/api/foods/${id}/sources`);
      const parsed = transcriptsSchema.safeParse(await response.json());
      setTranscripts(response.ok && parsed.success ? parsed.data.sources : []);
    } catch {
      setTranscripts([]);
    }
  }

  async function loadDrafts(selectFirst = true) {
    try {
      const response = await fetch("/api/foods/drafts");
      const parsed = draftsSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success)
        throw new Error("Draft 목록을 불러오지 못했습니다.");
      setFoods(parsed.data.foods);
      setFoodId((current) =>
        selectFirst ? current || String(parsed.data.foods[0]?.id ?? "") : "",
      );
    } catch (error: unknown) {
      setMessage(
        error instanceof Error
          ? error.message
          : "네트워크 오류가 발생했습니다.",
      );
    }
  }

  async function registerSource() {
    if (!selected || !url) return;
    const result = await request(`/api/foods/${selected.id}/sources`, {
      captureMethod: manualText ? "manual" : "fetch",
      capturedText: manualText || undefined,
      kind,
      url,
    });
    // 실패 시 입력을 지우지 않는다. 손으로 붙여넣은 전사본을 다시 받아낼 방법이 없다.
    if (result === null) return;
    const parsed = sourceCaptureResponseSchema.safeParse(result);
    if (!parsed.success) {
      setMessage("출처 수집 결과를 확인하지 못했습니다.");
      return;
    }
    setCaptureStatus(parsed.data.contentStatus);
    setUrl("");
    setManualText("");
    setCandidates([]);
    await loadDrafts();
    await loadTranscripts(selected.id);
  }

  async function extract() {
    if (!selected || fetchedSources.length === 0) return;
    const result = await request(`/api/foods/${selected.id}/sources/extract`, {
      sourceIds: fetchedSources.map((source) => source.id),
    });
    const parsed = z
      .object({ candidates: z.array(evidenceCandidateSchema) })
      .safeParse(result);
    if (parsed.success) setCandidates(parsed.data.candidates);
  }

  async function apply() {
    if (!selected || candidates.length === 0) return;
    const result = await request(`/api/foods/${selected.id}/sources/apply`, {
      evidence: candidates,
    });
    // 실패 시 후보를 버리면 유료 추출을 다시 돌려야 한다.
    if (result === null) return;
    const parsed = evidenceApplyResponseSchema.safeParse(result);
    if (!parsed.success) {
      setMessage("Draft 적용 결과를 확인하지 못했습니다.");
      return;
    }
    const conflicts = conflictCandidates(parsed.data.results);
    setCandidates(conflicts);
    if (conflicts.length > 0)
      setMessage(`저장값과 다른 후보 ${conflicts.length}건을 남겼습니다.`);
    await loadDrafts();
    await loadTranscripts(selected.id);
  }

  async function handlePublished() {
    setCandidates([]);
    setTranscripts([]);
    await loadDrafts(false);
  }

  function handlePublicationBusy(nextBusy: boolean) {
    setBusy(nextBusy);
    if (nextBusy) {
      setMessage(null);
      setCaptureStatus(null);
    }
  }

  async function request(path: string, body: object): Promise<unknown> {
    setBusy(true);
    setMessage(null);
    setCaptureStatus(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const error = z.object({ error: z.string() }).safeParse(data);
        throw new Error(
          error.success ? error.data.error : "요청에 실패했습니다.",
        );
      }
      return data;
    } catch (error: unknown) {
      setMessage(
        error instanceof Error
          ? error.message
          : "네트워크 오류가 발생했습니다.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <SourceCaptureForm
        busy={busy}
        captureStatus={captureStatus}
        fetchedSourceCount={fetchedSources.length}
        foodId={foodId}
        foods={foods}
        kind={kind}
        manualText={manualText}
        onFoodIdChange={setFoodId}
        onKindChange={setKind}
        onManualTextChange={setManualText}
        onRegisterSource={registerSource}
        onUrlChange={setUrl}
        url={url}
      />
      <SourceTranscriptPreviews sources={transcripts} />
      {/* 4단계 워크플로의 2단계다. .ghost는 부수적 동작용이라 나머지 셋과 크기가
          달라 순서가 순서로 읽히지 않았다. */}
      <button
        className="primary"
        disabled={busy || fetchedSources.length === 0}
        onClick={extract}
      >
        {busy ? "처리 중…" : "수집 원문에서 추출"}
      </button>
      {candidates.length > 0 && (
        <div className="panel">
          <strong>근거 후보</strong>
          {candidates.map((candidate) => (
            <p key={candidate.nutrientKey}>
              {candidate.nutrientKey}: {candidate.value} — {candidate.excerpt}
            </p>
          ))}
        </div>
      )}
      <button
        className="save"
        disabled={busy || candidates.length === 0}
        onClick={apply}
      >
        {busy ? "처리 중…" : "Draft로 적용"}
      </button>
      <SourcePublicationAction
        busy={busy}
        foodId={selected?.id ?? null}
        hasFetchedSource={fetchedSources.length > 0}
        hasUnappliedCandidates={candidates.length > 0}
        onBusyChange={handlePublicationBusy}
        onPublished={handlePublished}
      />
      {message && (
        <p className="err" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
