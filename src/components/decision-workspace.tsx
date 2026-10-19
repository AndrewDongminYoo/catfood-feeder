"use client";
import type { AdequacyProof } from "@/lib/adequacy-evidence";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import type { FoodWithBrand, NutrientEvidence } from "@/lib/catalog";
import {
  DEFAULT_DECISION_REQUEST,
  EXCLUSION_LABELS,
  PREFERENCE_LABELS,
  type ProteinPreference,
  buildFoodDecision,
  decisionSnapshotSchema,
  decisionRequestSchema,
  exportDecisionBrief,
  type DecisionRequest,
  type DecisionSnapshot,
  type IngredientProof,
  type IngredientExclusion,
} from "@/lib/food-decision";
import { parseDecisionQuestion } from "@/lib/decision-question";
import { DecisionReport } from "./decision-report";

const CHANGE_REASONS = [
  {
    label: "지금과 비슷한 다른 사료를 찾고 있어요",
    question: "지금 먹는 사료와 열량이 비슷한 다른 사료를 찾아요.",
  },
  {
    label: "열량이 높지 않은 쪽으로 바꾸고 싶어요",
    question: "지금 먹는 사료보다 열량이 높지 않은 사료를 찾아요.",
  },
  {
    label: "좋아하는 원료를 먼저 볼래요",
    question: "열량 차이와 좋아하는 원료를 함께 비교하고 싶어요.",
  },
  {
    label: "피해야 할 원료가 있어요",
    question: "열량 차이와 피해야 할 원료를 확인하고 싶어요.",
  },
] as const;

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
  adequacyByFoodId?: Readonly<Record<number, readonly AdequacyProof[]>>;
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
  const [stage, setStage] = useState(0);
  const [showExclusions, setShowExclusions] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [search, setSearch] = useState("");
  const [manual, setManual] = useState(false);
  const [refreshed, setRefreshed] = useState<DecisionWorkspaceProps | null>(
    null,
  );
  const data = refreshed ?? props;
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
      foods: data.foods,
      evidenceByFoodId: new Map(data.evidence),
      ingredientEvidenceByFoodId: data.ingredientEvidenceByFoodId,
      adequacyByFoodId: data.adequacyByFoodId,
    }),
    [
      data.foods,
      data.evidence,
      data.ingredientEvidenceByFoodId,
      data.adequacyByFoodId,
    ],
  );
  const filteredFoods = data.foods.filter((f) =>
    `${f.brands?.name ?? ""} ${f.product_name}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const needsInterpretation =
    request.question.trim() !== "" && interpretedQuestion !== request.question;
  const parsedRequest = decisionRequestSchema.safeParse(request);
  const conditionsChanged =
    snapshot !== null &&
    (!parsedRequest.success ||
      JSON.stringify(parsedRequest.data) !==
        JSON.stringify(snapshot.report.request));

  const canLeaveCurrent =
    data.available &&
    request.adultNonPrescription &&
    parsedRequest.success &&
    (manual
      ? request.manualCurrentName.trim() !== ""
      : data.foods.some((f) => f.id === request.currentFoodId));
  function setCalorieChoice(
    notHigherKcal: boolean,
    maxKcalDeltaPct: number | null,
  ) {
    setRequest((r) => ({
      ...r,
      notHigherKcal,
      maxKcalDeltaPct,
      pendingClarifications: (r.pendingClarifications ?? []).filter(
        (x) => x !== "calories",
      ),
    }));
  }
  function update<K extends keyof DecisionRequest>(
    key: K,
    value: DecisionRequest[K],
  ) {
    setRequest((r) => ({ ...r, [key]: value }));
  }
  function applyInterpretation(
    question: string,
    result: ReturnType<typeof parseDecisionQuestion>,
  ) {
    setInterpretedQuestion(question);
    setRequest((r) => ({
      ...r,
      exclusions: [...new Set([...r.exclusions, ...result.exclusions])],
      maxKcalDeltaPct: result.maxKcalDeltaPct ?? r.maxKcalDeltaPct,
      unresolvedRequirements: result.unhandled,
      ignoredRequirements: [],
      scopeConcern: result.outsideScope,
      pendingClarifications: result.clarifications,
      notHigherKcal: (r.notHigherKcal ?? false) || result.notHigherKcal,
      poultryFirst: r.poultryFirst ?? false,
      preferredProteins: result.clarifications.includes("poultry")
        ? [...new Set([...(r.preferredProteins ?? []), "poultry" as const])]
        : r.preferredProteins,
    }));
  }
  async function continueQuestion(useModel: boolean) {
    if (busy) return;
    if (interpretedQuestion !== request.question) {
      if (useModel) await interpretQuestion();
      else {
        applyInterpretation(
          request.question,
          parseDecisionQuestion(request.question),
        );
        setMessage(
          "질문에서 기본 조건만 읽었습니다. 빠진 요구와 비교 기준을 직접 확인해 주세요.",
        );
      }
    }
    setStage(2);
  }
  async function interpretQuestion() {
    const question = request.question;
    if (!question.trim() || busy) return;
    setBusy(true);
    setMessage("질문에 담긴 조건을 읽고 있습니다.");
    let result = parseDecisionQuestion(question);
    let notice =
      "AI로 질문 전체를 해석하지 못해 기본 조건만 읽었습니다. 확인할 요구와 기준을 아래에서 확인해 주세요.";
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
    applyInterpretation(question, result);
    setMessage(notice);
    setBusy(false);
  }
  function evaluate(input: DecisionRequest, currentCatalog = catalog) {
    setSnapshot({
      version: 1,
      report: buildFoodDecision(currentCatalog, input),
      selectedFoodId: null,
      reason: "",
    });
    setHistorical(false);
    setStage(3);
    setMessage(
      "입력한 조건으로 비교했습니다. 충족한 조건과 확인할 질문을 함께 읽어주세요.",
    );
  }
  async function recheck() {
    if (!snapshot || busy) return;
    setBusy(true);
    setMessage("현재 카탈로그 자료를 다시 읽고 있습니다.");
    try {
      const response = await fetch("/api/advisor/catalog", {
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("catalog unavailable");
      const latest: DecisionWorkspaceProps = await response.json();
      if (
        !latest.available ||
        !Array.isArray(latest.foods) ||
        !Array.isArray(latest.evidence) ||
        !latest.ingredientEvidenceByFoodId
      )
        throw new Error("invalid catalog");
      setRefreshed(latest);
      evaluate(request, {
        foods: latest.foods,
        evidenceByFoodId: new Map(latest.evidence),
        ingredientEvidenceByFoodId: latest.ingredientEvidenceByFoodId,
        adequacyByFoodId: latest.adequacyByFoodId,
      });
      setMessage(
        "현재 카탈로그로 다시 비교했습니다. 이전에 저장한 기록은 그대로 남아 있습니다.",
      );
    } catch {
      setMessage(
        "현재 자료를 읽지 못했습니다. 표시 중인 검토와 자료 시점은 그대로 유지했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (stage === 0 && canLeaveCurrent) {
      setStage(1);
      return;
    }
    if (stage === 1 && !busy && request.question.trim()) {
      void continueQuestion(true);
      return;
    }
    if (stage === 2) evaluate(request);
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
    setStage(3);
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
      {!data.available && (
        <div className="err" role="alert">
          사료 자료를 불러오지 못했습니다. 페이지를 새로고침해 다시 시도해
          주세요. 저장한 검토는 아래에서 볼 수 있습니다.
        </div>
      )}
      {data.sample && (
        <div className="notice">
          샘플 자료를 보고 있습니다. 실제 구매 후보를 비교하려면 운영 카탈로그
          연결이 필요합니다.
        </div>
      )}
      <nav className="decision-steps" aria-label="사료 선택 단계">
        <ol>
          {["현재 사료", "교체 이유", "중요한 조건", "구매 후보"].map(
            (label, index) => (
              <li
                key={label}
                aria-current={stage === index ? "step" : undefined}
              >
                <span>{index + 1}</span>
                {label}
              </li>
            ),
          )}
        </ol>
      </nav>
      {stage < 3 && (
        <form className="decision-form card" onSubmit={submit}>
          {stage === 0 && (
            <section className="decision-current-step">
              <h2>지금 어떤 사료를 먹고 있나요?</h2>
              <p>지금 먹는 사료가 다음 후보를 비교하는 출발점이 됩니다.</p>
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
                disabled={!data.available}
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
                  data.foods
                    .filter((f) => f.id === request.currentFoodId)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.brands?.name ?? ""} · {f.product_name}
                      </option>
                    ))}
              </select>
              {manual && (
                <div className="decision-manual">
                  <label htmlFor="manual-food">
                    포장에 적힌 현재 사료 이름
                  </label>
                  <input
                    id="manual-food"
                    maxLength={160}
                    required
                    value={request.manualCurrentName}
                    onChange={(e) =>
                      update("manualCurrentName", e.target.value)
                    }
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
              <div className="decision-submit">
                <button
                  type="button"
                  className="primary"
                  disabled={!canLeaveCurrent}
                  onClick={() => setStage(1)}
                >
                  다음: 바꾸려는 이유
                </button>
              </div>
            </section>
          )}
          {stage === 1 && (
            <section className="decision-question-input">
              <h2>어떤 점을 바꾸고 싶나요?</h2>
              <p>가장 중요한 이유를 고르거나, 아래에 직접 이야기해 주세요.</p>
              <div className="decision-reason-options">
                {CHANGE_REASONS.map((reason) => (
                  <button
                    key={reason.label}
                    type="button"
                    className="ghost"
                    disabled={busy}
                    aria-pressed={request.changeReason === reason.label}
                    onClick={() =>
                      setRequest((r) => ({
                        ...r,
                        changeReason: reason.label,
                        question: reason.question,
                      }))
                    }
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
              <label htmlFor="decision-question">
                다음 사료에 대해 궁금한 점
              </label>
              <textarea
                id="decision-question"
                rows={3}
                disabled={busy}
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
                  onClick={() => void continueQuestion(true)}
                >
                  {busy
                    ? "조건 읽는 중…"
                    : !needsInterpretation && request.question.trim()
                      ? "확인한 조건으로 돌아가기"
                      : "질문에서 조건 읽기"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void continueQuestion(false)}
                >
                  조건을 직접 정할게요
                </button>
                <span>
                  질문을 AI로 정리할 수 있습니다. 조건을 직접 골라도 비교할 수
                  있습니다.
                </span>
              </div>

              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => setStage(0)}
              >
                이전: 현재 사료
              </button>
            </section>
          )}
          {stage === 2 && (
            <section className="decision-followups">
              <h2>
                {request.catName || "우리 고양이"}에게 중요한 조건만 확인할게요
              </h2>
              <p>꼭 피할 원료와 더 좋아하는 원료는 따로 반영합니다.</p>
              {(request.unresolvedRequirements?.length ?? 0) +
                (request.ignoredRequirements?.length ?? 0) >
              0 ? (
                <div className="warn">
                  <strong>이 요구는 아직 확인하지 못했습니다</strong>
                  <p>
                    아래 요구는 결과에서도 확인 필요로 남깁니다. 이번 비교에서
                    빼려면 직접 선택해 주세요.
                  </p>
                  {[
                    ...new Set([
                      ...(request.unresolvedRequirements ?? []),
                      ...(request.ignoredRequirements ?? []),
                    ]),
                  ].map((text) => (
                    <label className="check" key={text}>
                      <input
                        type="checkbox"
                        checked={(request.ignoredRequirements ?? []).includes(
                          text,
                        )}
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

              {showExclusions ||
              request.exclusions.length > 0 ||
              request.changeReason?.includes("피해야") ? (
                <section>
                  <h3>꼭 피해야 할 원료가 있나요?</h3>
                  <fieldset>
                    <legend>원재료 목록에서 제외할 표기</legend>
                    <p>
                      유래 원료도 함께 확인합니다. 혼입이나 알레르기 안전성은
                      판정하지 않습니다.
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
                            onChange={(e) => {
                              setShowExclusions(true);
                              update(
                                "exclusions",
                                e.target.checked
                                  ? [...request.exclusions, key]
                                  : request.exclusions.filter((x) => x !== key),
                              );
                            }}
                          />
                          {label} 표기 제외
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </section>
              ) : (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowExclusions(true)}
                >
                  피해야 할 원료도 정할게요
                </button>
              )}
              {showPreferences ||
              (request.preferredProteins?.length ?? 0) > 0 ||
              request.pendingClarifications?.includes("poultry") ||
              request.changeReason?.includes("좋아하는") ? (
                <section>
                  <h3>어떤 원료를 더 좋아하나요?</h3>
                  <p className="decision-caption">
                    선호한 원료가 앞에 표기된 후보를 먼저 보여줍니다. 다른
                    원료의 후보도 남기며, 잘 먹을지는 예측하지 않습니다.
                  </p>
                  <fieldset className="decision-preferences">
                    <legend>좋아하는 원료 (선택)</legend>
                    <div className="decision-exclusion-inputs">
                      {Object.entries(PREFERENCE_LABELS).map(([key, label]) => (
                        <label className="check" key={key}>
                          <input
                            type="checkbox"
                            checked={(request.preferredProteins ?? []).includes(
                              key as ProteinPreference,
                            )}
                            onChange={(e) => {
                              setShowPreferences(true);
                              setRequest((r) => ({
                                ...r,
                                preferredProteins: e.target.checked
                                  ? [
                                      ...(r.preferredProteins ?? []),
                                      key as ProteinPreference,
                                    ]
                                  : (r.preferredProteins ?? []).filter(
                                      (x) => x !== key,
                                    ),
                                pendingClarifications: (
                                  r.pendingClarifications ?? []
                                ).filter((x) => x !== "poultry"),
                              }));
                            }}
                          />
                          {label} 선호
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {request.pendingClarifications?.includes("poultry") && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        update(
                          "pendingClarifications",
                          (request.pendingClarifications ?? []).filter(
                            (x) => x !== "poultry",
                          ),
                        )
                      }
                    >
                      이 선호로 후보 먼저 보기
                    </button>
                  )}
                </section>
              ) : (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowPreferences(true)}
                >
                  좋아하는 원료도 정할게요
                </button>
              )}
              <section>
                <h3>열량은 어떤 쪽으로 바꾸고 싶나요?</h3>
                <div className="decision-reason-options">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setCalorieChoice(false, 10)}
                  >
                    지금과 비슷하게 · 차이 10% 이내
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setCalorieChoice(true, 10)}
                  >
                    지금보다 높지 않게 · 차이 10% 이내
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setCalorieChoice(false, null)}
                  >
                    열량으로 후보를 제한하지 않을게요
                  </button>
                </div>
                <label htmlFor="decision-kcal">
                  현재 사료와 허용할 열량 차이
                </label>
                <select
                  id="decision-kcal"
                  value={request.maxKcalDeltaPct ?? "none"}
                  onChange={(e) =>
                    update(
                      "maxKcalDeltaPct",
                      e.target.value === "none" ? null : Number(e.target.value),
                    )
                  }
                >
                  {request.maxKcalDeltaPct !== null &&
                    ![5, 10, 15].includes(request.maxKcalDeltaPct) && (
                      <option value={request.maxKcalDeltaPct}>
                        {request.maxKcalDeltaPct}% 이내 · 질문에서 지정
                      </option>
                    )}
                  <option value="5">5% 이내</option>
                  <option value="10">10% 이내</option>
                  <option value="15">15% 이내</option>
                  <option value="none">열량으로 제한하지 않기</option>
                </select>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={request.notHigherKcal ?? false}
                    onChange={(e) => update("notHigherKcal", e.target.checked)}
                  />
                  현재 사료보다 열량이 높지 않은 후보
                </label>
                {request.pendingClarifications?.includes("calories") && (
                  <div className="warn">
                    <strong>
                      ‘비슷하게’와 ‘높지 않게’의 기준을 정해주세요
                    </strong>
                    <p>
                      위 허용 차이와 ‘현재 이하’ 설정은 이번 비교를 위한
                      선택입니다. 건강에 적합한 기준으로 자동 판단하지 않습니다.
                    </p>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        update(
                          "pendingClarifications",
                          request.pendingClarifications?.filter(
                            (x) => x !== "calories",
                          ),
                        )
                      }
                    >
                      이 열량 기준으로 비교하기
                    </button>
                  </div>
                )}
              </section>
              {request.poultryFirst && (
                <details>
                  <summary>저장된 추가 제외 기준</summary>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={request.poultryFirst ?? false}
                      onChange={(e) => update("poultryFirst", e.target.checked)}
                    />
                    가금육이 생선보다 먼저 표기된 후보
                  </label>
                  <p className="decision-caption">
                    닭·칠면조·오리·가금육 표기와 생선의 순서를 비교합니다. 실제
                    함량 비율이나 잘 먹을지를 예측하지 않습니다.
                  </p>
                </details>
              )}
              <div className="decision-submit">
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    !data.available ||
                    busy ||
                    needsInterpretation ||
                    !parsedRequest.success
                  }
                >
                  조건 확인하고 후보 비교하기
                </button>
                <p>
                  반드시 지킬 조건은 완화하지 않습니다. 모르는 부분은 확인할
                  질문으로 남깁니다.
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setStage(1)}
              >
                이전: 바꾸려는 이유
              </button>
            </section>
          )}
        </form>
      )}
      {stage === 3 && (
        <div className="decision-actions">
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => setStage(2)}
          >
            조건 바꾸기
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => setStage(0)}
          >
            현재 사료 바꾸기
          </button>
        </div>
      )}
      <p className="decision-status" role="status" aria-live="polite">
        {message}
      </p>
      {snapshot && stage === 3 && (
        <>
          {conditionsChanged && (
            <div className="warn" role="status">
              조건이 바뀌었습니다. 아래 결과와 저장 내용은 이전 조건입니다. 후보
              비교나 현재 자료 재조회를 눌러 변경한 조건을 적용해 주세요.
            </div>
          )}
          <DecisionReport
            report={snapshot.report}
            historical={historical}
            comparisonDisabled={
              busy || needsInterpretation || !parsedRequest.success
            }
            onSelect={(id) => {
              setSnapshot((s) => (s ? { ...s, selectedFoodId: id } : s));
              setMessage(
                "후보를 기록에 담았습니다. 아래에 선택 이유를 적고 저장해 주세요.",
              );
              document.getElementById("decision-reason")?.focus();
            }}
            onToleranceChange={(value) => {
              const next = {
                ...request,
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
                  onClick={recheck}
                  disabled={
                    busy || needsInterpretation || !parsedRequest.success
                  }
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
                  disabled={busy}
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
