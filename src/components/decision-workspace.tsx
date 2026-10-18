"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import type { FoodWithBrand, NutrientEvidence } from "@/lib/catalog";
import {
  DEFAULT_DECISION_REQUEST,
  EXCLUSION_LABELS,
  buildFoodDecision,
  decisionSnapshotSchema,
  exportDecisionBrief,
  type DecisionRequest,
  type DecisionSnapshot,
  type IngredientProof,
  type IngredientExclusion,
} from "@/lib/food-decision";
import {
  parseDecisionQuestion,
  type QuestionInterpretation,
} from "@/lib/decision-question";
import { DecisionReport } from "./decision-report";

const STORAGE_KEY = "catfood.decisions.v1";
function readStorage() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "unavailable";
  }
}
function subscribeStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("catfood-decision-saved", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("catfood-decision-saved", callback);
  };
}
function parseSaved(value: string): DecisionSnapshot[] {
  try {
    const list: unknown = JSON.parse(value);
    return Array.isArray(list)
      ? list.slice(0, 12).flatMap((v) => {
          const parsed = decisionSnapshotSchema.safeParse(v);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
  } catch {
    return [];
  }
}

export interface DecisionWorkspaceProps {
  available: boolean;
  sample: boolean;
  foods: readonly FoodWithBrand[];
  evidence: readonly (readonly [number, readonly NutrientEvidence[]])[];
  ingredientEvidenceByFoodId: Readonly<Record<number, IngredientProof>>;
}

export function DecisionWorkspace(props: DecisionWorkspaceProps) {
  const [request, setRequest] = useState<DecisionRequest>(
    DEFAULT_DECISION_REQUEST,
  );
  const [search, setSearch] = useState("");
  const [manual, setManual] = useState(false);
  const [interpretation, setInterpretation] =
    useState<QuestionInterpretation | null>(null);
  const [interpretedQuestion, setInterpretedQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [snapshot, setSnapshot] = useState<DecisionSnapshot | null>(null);
  const [historical, setHistorical] = useState(false);
  const storage = useSyncExternalStore(
    subscribeStorage,
    readStorage,
    () => "[]",
  );
  const saved = useMemo(() => parseSaved(storage), [storage]);
  const catalog = useMemo(
    () => ({
      foods: props.foods,
      evidenceByFoodId: new Map(props.evidence),
      ingredientEvidenceByFoodId: props.ingredientEvidenceByFoodId,
    }),
    [props.foods, props.evidence, props.ingredientEvidenceByFoodId],
  );
  const filteredFoods = props.foods.filter((f) =>
    `${f.brands?.name ?? ""} ${f.product_name}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const needsInterpretation =
    request.question.trim() !== "" && interpretedQuestion !== request.question;

  function update<K extends keyof DecisionRequest>(
    key: K,
    value: DecisionRequest[K],
  ) {
    setRequest((r) => ({ ...r, [key]: value }));
  }
  async function interpretQuestion() {
    const question = request.question;
    if (!question.trim() || busy) return;
    setBusy(true);
    setMessage("질문에 담긴 조건을 읽고 있습니다.");
    let result = parseDecisionQuestion(question);
    let notice =
      "질문에서 읽은 조건을 표시했습니다. 빠진 조건은 아래에서 직접 선택해 주세요.";
    try {
      const response = await fetch("/api/advisor/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: AbortSignal.timeout(35_000),
      });
      if (response.ok) {
        const body = await response.json();
        if (
          body.interpretation &&
          Array.isArray(body.interpretation.exclusions)
        )
          result = body.interpretation;
        if (body.mode === "ai")
          notice =
            "AI가 질문을 아래 조건으로 정리했습니다. 원하는 뜻과 같은지 확인하고 수정해 주세요.";
      }
    } catch {
      /* 질문과 직접 입력 경로는 그대로 유지한다. */
    }
    setInterpretation(result);
    setInterpretedQuestion(question);
    setRequest((r) => ({
      ...r,
      exclusions: result.exclusions,
      maxKcalDeltaPct: result.maxKcalDeltaPct ?? r.maxKcalDeltaPct,
      unresolvedRequirements: result.unhandled,
      ignoredRequirements: [],
      scopeConcern: result.outsideScope,
    }));
    setMessage(notice);
    setBusy(false);
  }
  function evaluate(input: DecisionRequest) {
    setSnapshot({
      version: 1,
      report: buildFoodDecision(catalog, input),
      selectedFoodId: null,
      reason: "",
    });
    setHistorical(false);
    setMessage(
      "입력한 조건으로 비교했습니다. 충족한 조건과 확인할 질문을 함께 읽어주세요.",
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    evaluate(request);
  }
  function persist() {
    if (!snapshot) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          [
            snapshot,
            ...saved.filter(
              (s) => s.report.createdAt !== snapshot.report.createdAt,
            ),
          ].slice(0, 12),
        ),
      );
      window.dispatchEvent(new Event("catfood-decision-saved"));
      setMessage("현재 자료와 선택 이유를 이 브라우저에 저장했습니다.");
    } catch {
      setMessage(
        "브라우저에 기록을 저장하지 못했습니다. 검토 기록 내려받기를 이용해 주세요.",
      );
    }
  }
  function download() {
    if (!snapshot) return;
    const url = URL.createObjectURL(
      new Blob([exportDecisionBrief(snapshot)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `catfood-decision-${snapshot.report.createdAt.slice(0, 10)}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function restore(value: DecisionSnapshot) {
    setSnapshot(value);
    setRequest(value.report.request);
    setManual(value.report.request.currentFoodId === null);
    setInterpretedQuestion(value.report.request.question);
    setHistorical(true);
    setMessage("저장한 검토를 불러왔습니다. 저장 당시의 자료를 보여드립니다.");
  }

  return (
    <main className="wide decision-workspace">
      <header className="decision-hero">
        <div>
          <p className="eyebrow">다음 한 봉지를 고르기 전에</p>
          <h1>
            우리 고양이,
            <br />
            다음 사료는 뭘 살까요?
          </h1>
          <p className="decision-intro">
            지금 먹는 사료와 바꾸고 싶은 이유를 알려주세요. 후보마다 무엇이
            달라지고, 어떤 근거가 있으며, 무엇을 더 확인해야 하는지 비교합니다.
          </p>
        </div>
        <aside>
          <span>선택의 근거를 함께</span>
          <ol>
            <li>질문을 비교 조건으로</li>
            <li>조건을 출처와 대조</li>
            <li>선택과 남은 질문을 기록</li>
          </ol>
          <a href="#decision-saved">저장한 검토 {saved.length}개 보기 ↓</a>
        </aside>
      </header>
      {!props.available && (
        <div className="err" role="alert">
          사료 자료를 불러오지 못했습니다. 페이지를 새로고침해 다시 시도해
          주세요. 저장한 검토는 아래에서 볼 수 있습니다.
        </div>
      )}
      {props.sample && (
        <div className="notice">
          샘플 자료를 보고 있습니다. 실제 구매 후보를 비교하려면 운영 카탈로그
          연결이 필요합니다.
        </div>
      )}
      <form className="decision-form card" onSubmit={submit}>
        <section className="decision-question-input">
          <p className="eyebrow">01 · 이번 선택에서 중요한 점</p>
          <label htmlFor="decision-question">다음 사료에 대해 궁금한 점</label>
          <textarea
            id="decision-question"
            rows={3}
            maxLength={1200}
            value={request.question}
            onChange={(e) => update("question", e.target.value)}
            placeholder="예: 지금 먹는 사료와 열량은 비슷하게, 닭고기 표기가 없는 후보를 찾고 싶어요."
          />
          <div className="decision-question-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || !request.question.trim()}
              onClick={interpretQuestion}
            >
              {busy ? "조건 읽는 중…" : "질문에서 조건 읽기"}
            </button>
            <span>
              질문을 AI로 정리할 수 있습니다. 조건을 직접 골라도 비교할 수
              있습니다.
            </span>
          </div>
          {interpretation?.unhandled.length ? (
            <div className="warn">
              <strong>이 요구는 아직 확인하지 못했습니다</strong>
              <p>
                아래 요구는 결과에서도 확인 필요로 남깁니다. 이번 비교에서
                빼려면 직접 선택해 주세요.
              </p>
              {interpretation.unhandled.map((text) => (
                <label className="check" key={text}>
                  <input
                    type="checkbox"
                    checked={(request.ignoredRequirements ?? []).includes(text)}
                    onChange={(e) => {
                      setRequest((r) => ({
                        ...r,
                        ignoredRequirements: e.target.checked
                          ? [...(r.ignoredRequirements ?? []), text]
                          : (r.ignoredRequirements ?? []).filter(
                              (x) => x !== text,
                            ),
                        unresolvedRequirements: e.target.checked
                          ? (r.unresolvedRequirements ?? []).filter(
                              (x) => x !== text,
                            )
                          : [...(r.unresolvedRequirements ?? []), text],
                      }));
                    }}
                  />
                  이 요구를 이번 비교에서 제외하기: {text}
                </label>
              ))}
            </div>
          ) : null}
        </section>
        <div className="decision-input-grid">
          <section>
            <p className="eyebrow">02 · 비교의 출발점</p>
            <label htmlFor="decision-cat">
              고양이 이름 <span>(선택)</span>
            </label>
            <input
              id="decision-cat"
              value={request.catName}
              maxLength={60}
              onChange={(e) => update("catName", e.target.value)}
              placeholder="우리 고양이"
            />
            <label htmlFor="decision-food-search">현재 사료 검색</label>
            <input
              id="decision-food-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="브랜드 또는 제품명으로 좁히기"
            />
            <label htmlFor="decision-food">현재 먹는 사료</label>
            <select
              id="decision-food"
              value={manual ? "manual" : (request.currentFoodId ?? "")}
              disabled={!props.available}
              onChange={(e) => {
                setManual(e.target.value === "manual");
                update(
                  "currentFoodId",
                  e.target.value && e.target.value !== "manual"
                    ? Number(e.target.value)
                    : null,
                );
              }}
            >
              <option value="">현재 사료를 골라주세요</option>
              <option value="manual">목록에 없는 사료 · 직접 입력</option>
              {filteredFoods.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.brands?.name ?? ""} · {f.product_name}
                </option>
              ))}
              {request.currentFoodId !== null &&
                !filteredFoods.some((f) => f.id === request.currentFoodId) &&
                props.foods
                  .filter((f) => f.id === request.currentFoodId)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.brands?.name ?? ""} · {f.product_name}
                    </option>
                  ))}
            </select>
            {manual && (
              <div className="decision-manual">
                <label htmlFor="manual-food">포장에 적힌 현재 사료 이름</label>
                <input
                  id="manual-food"
                  maxLength={160}
                  required
                  value={request.manualCurrentName}
                  onChange={(e) => update("manualCurrentName", e.target.value)}
                />
                <label htmlFor="manual-kcal">
                  포장에 적힌 열량 <span>(kcal/kg, 선택)</span>
                </label>
                <input
                  id="manual-kcal"
                  type="number"
                  min={500}
                  max={10000}
                  step="any"
                  value={request.manualKcal ?? ""}
                  onChange={(e) =>
                    update(
                      "manualKcal",
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                />
                <p>
                  직접 입력한 값으로 표시합니다. kcal/컵이나 kcal/100g 값을
                  그대로 넣지 마세요.
                </p>
              </div>
            )}
          </section>
          <section>
            <p className="eyebrow">03 · 지키고 싶은 조건</p>
            <fieldset>
              <legend>원재료 목록에서 제외할 표기</legend>
              <p>
                유래 원료도 함께 확인합니다. 혼입이나 알레르기 안전성은 판정하지
                않습니다.
              </p>
              <div className="decision-exclusion-inputs">
                {(
                  Object.entries(EXCLUSION_LABELS) as [
                    IngredientExclusion,
                    string,
                  ][]
                ).map(([key, label]) => (
                  <label className="check" key={key}>
                    <input
                      type="checkbox"
                      checked={request.exclusions.includes(key)}
                      onChange={(e) =>
                        update(
                          "exclusions",
                          e.target.checked
                            ? [...request.exclusions, key]
                            : request.exclusions.filter((x) => x !== key),
                        )
                      }
                    />
                    {label} 표기 제외
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor="decision-kcal">현재 사료와 허용할 열량 차이</label>
            <select
              id="decision-kcal"
              value={request.maxKcalDeltaPct ?? "none"}
              onChange={(e) =>
                update(
                  "maxKcalDeltaPct",
                  e.target.value === "none"
                    ? null
                    : (Number(e.target.value) as 5 | 10 | 15),
                )
              }
            >
              <option value="5">5% 이내</option>
              <option value="10">10% 이내</option>
              <option value="15">15% 이내</option>
              <option value="none">열량으로 제한하지 않기</option>
            </select>
            <p className="decision-caption">
              열량 밀도 차이를 비교하는 개인 조건입니다. 급여량이나 건강에
              적합한 차이를 정하는 기준은 아닙니다.
            </p>
            <label className="check decision-scope">
              <input
                type="checkbox"
                checked={request.adultNonPrescription}
                onChange={(e) =>
                  update("adultNonPrescription", e.target.checked)
                }
              />
              성묘의 일반 건사료를 비교합니다. 질환·처방식·임신·수유를 위한
              선택이 아닙니다.
            </label>
          </section>
        </div>
        <div className="decision-submit">
          <button
            className="primary"
            type="submit"
            disabled={!props.available || busy || needsInterpretation}
          >
            조건 확인하고 후보 비교하기
          </button>
          <p>
            {needsInterpretation
              ? "질문을 바꿨습니다. ‘질문에서 조건 읽기’로 조건을 다시 확인해 주세요."
              : "입력한 조건을 자동으로 완화하지 않습니다. 확인할 수 없는 항목도 함께 보여드립니다."}
          </p>
        </div>
      </form>
      <p className="decision-status" role="status" aria-live="polite">
        {message}
      </p>
      {snapshot && (
        <>
          <DecisionReport
            report={snapshot.report}
            historical={historical}
            onSelect={(id) => {
              setSnapshot((s) => (s ? { ...s, selectedFoodId: id } : s));
              setMessage(
                "후보를 기록에 담았습니다. 아래에 선택 이유를 적고 저장해 주세요.",
              );
              document.getElementById("decision-reason")?.focus();
            }}
            onToleranceChange={(value) => {
              const next = {
                ...snapshot.report.request,
                maxKcalDeltaPct: value,
              };
              setRequest(next);
              evaluate(next);
            }}
          />
          {snapshot.report.status === "ready" && (
            <section className="card decision-save">
              <p className="eyebrow">이번 선택을 남겨두세요</p>
              <h2>지금 고른 이유가 다음 비교의 기준이 됩니다</h2>
              <label htmlFor="decision-choice">
                다음에 확인하거나 구매할 후보
              </label>
              <select
                id="decision-choice"
                value={snapshot.selectedFoodId ?? ""}
                onChange={(e) =>
                  setSnapshot({
                    ...snapshot,
                    selectedFoodId: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              >
                <option value="">아직 선택하지 않음 · 검토 보류</option>
                {snapshot.report.eligible
                  .concat(snapshot.report.unresolved)
                  .map((c) => (
                    <option value={c.food.id} key={c.food.id}>
                      {c.food.brand} · {c.food.product_name}
                      {c.conditions.some((x) => x.status === "unknown")
                        ? " (확인 필요)"
                        : ""}
                    </option>
                  ))}
              </select>
              <label htmlFor="decision-reason">선택 또는 보류 이유</label>
              <textarea
                id="decision-reason"
                rows={2}
                maxLength={1000}
                value={snapshot.reason}
                onChange={(e) =>
                  setSnapshot({ ...snapshot, reason: e.target.value })
                }
                placeholder="예: 열량 차이가 작아 후보로 남김. 구매 전 가금육의 종을 확인할 예정."
              />
              <div className="decision-actions">
                <button type="button" className="primary" onClick={persist}>
                  검토 기록 저장하기
                </button>
                <button type="button" className="ghost" onClick={download}>
                  검토 기록 내려받기
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    evaluate(snapshot.report.request);
                    setMessage(
                      "현재 카탈로그로 다시 비교했습니다. 이전에 저장한 기록은 그대로 남아 있습니다.",
                    );
                  }}
                >
                  현재 자료로 다시 비교하기
                </button>
              </div>
              <p className="decision-caption">
                자료와 근거를 이 브라우저에 최대 12건 저장합니다. 다른 기기로
                옮기거나 보관하려면 내려받기를 이용해 주세요.
              </p>
            </section>
          )}
        </>
      )}
      <section id="decision-saved" className="card decision-saved">
        <h2>저장한 검토</h2>
        {storage === "unavailable" && (
          <p className="warn">
            브라우저에 기록을 저장할 수 없습니다. 비교 결과를 내려받아 보관할 수
            있습니다.
          </p>
        )}
        {storage !== "unavailable" &&
          storage !== "[]" &&
          saved.length === 0 && (
            <p className="warn">
              저장한 기록을 읽지 못했습니다. 새 검토를 진행하고 내려받아 보관해
              주세요.
            </p>
          )}
        {saved.length === 0 ? (
          <p>
            아직 저장한 검토가 없습니다. 후보를 비교한 뒤 선택하거나 보류한
            이유를 남겨보세요.
          </p>
        ) : (
          <ul>
            {saved.map((s) => (
              <li key={s.report.createdAt}>
                <div>
                  <strong>
                    {s.report.request.catName || "우리 고양이"} ·{" "}
                    {s.report.baseline.name}
                  </strong>
                  <p>
                    {s.report.createdAt.slice(0, 10)} ·{" "}
                    {s.reason || "선택 이유 미기록"}
                  </p>
                </div>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => restore(s)}
                  aria-label={`${s.report.createdAt.slice(0, 10)} 저장한 검토 불러오기`}
                >
                  불러오기
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
