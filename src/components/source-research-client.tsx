"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import {
  conflictCandidates,
  evidenceApplyResponseSchema,
  evidenceCandidateSchema,
} from "@/lib/source-apply";
import {
  sourceCaptureResponseSchema,
  sourceCaptureStatusMessage,
  sourceCaptureTone,
} from "@/lib/source-capture-response";
import type { SourceContentStatus } from "@/lib/source-capture-response";

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

  const selected = foods.find((food) => String(food.id) === foodId) ?? null;
  const fetchedSources =
    selected?.food_sources.filter(
      (source) => source.is_current && source.fetch_status === "fetched",
    ) ?? [];

  useEffect(() => {
    void loadDrafts();
  }, []);

  async function loadDrafts() {
    try {
      const response = await fetch("/api/foods/drafts");
      const parsed = draftsSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success)
        throw new Error("Draft 목록을 불러오지 못했습니다.");
      setFoods(parsed.data.foods);
      setFoodId((current) => current || String(parsed.data.foods[0]?.id ?? ""));
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
      <label>
        Draft 제품
        <select
          value={foodId}
          onChange={(event) => setFoodId(event.target.value)}
        >
          <option value="">선택하세요</option>
          {foods.map((food) => (
            <option key={food.id} value={food.id}>
              {food.brands?.name ?? "미분류"} — {food.product_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        출처 종류
        <select
          value={kind}
          onChange={(event) => {
            const parsedKind = z
              .enum(["manufacturer", "kr_label"])
              .safeParse(event.target.value);
            if (parsedKind.success) setKind(parsedKind.data);
          }}
        >
          <option value="manufacturer">제조사</option>
          <option value="kr_label">국내 라벨</option>
        </select>
      </label>
      <label>
        제품 URL
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://..."
        />
      </label>
      <label>
        수동 전사본 (선택)
        <textarea
          className="sm"
          value={manualText}
          onChange={(event) => setManualText(event.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={busy || !selected || !url}
        onClick={registerSource}
      >
        출처 수집
      </button>
      {captureStatus && (
        <p
          className={
            sourceCaptureTone(captureStatus) === "warning"
              ? "flag warn"
              : "okbox"
          }
          role={
            sourceCaptureTone(captureStatus) === "warning" ? "alert" : "status"
          }
        >
          {sourceCaptureStatusMessage(captureStatus)}
        </p>
      )}
      {fetchedSources.length > 0 && (
        <div className="warn" role="status">
          수집 완료 출처 {fetchedSources.length}개
        </div>
      )}
      <button
        className="ghost"
        disabled={busy || fetchedSources.length === 0}
        onClick={extract}
      >
        수집 원문에서 추출
      </button>
      {candidates.length > 0 && (
        <div className="card">
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
        Draft로 적용
      </button>
      {message && (
        <p className="err" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
