import Link from "next/link";
import type { Route } from "next";
import type {
  AdvisorReason,
  AdvisorSelection,
  AdvisorTradeoff,
  AdvisorUnknown,
} from "@/lib/advisor";
import type { FoodWithBrand } from "@/lib/catalog";
import { nutritionFacts, type NutritionFact } from "@/lib/catalog-presentation";

type ReadySelection = Extract<AdvisorSelection, { kind: "ready" }>;

export type AdvisorViewState =
  | { kind: "empty" }
  | { kind: "invalid_query" }
  | {
      kind: "data_unavailable";
      reason: "not_configured" | "load_failed";
    }
  | { kind: "current_food_not_found" }
  | {
      kind: "ready";
      currentFood: FoodWithBrand;
      selection: ReadySelection;
    };

const REASON_LABELS: Record<AdvisorReason, string> = {
  cooking_method_match: "제조 방식 일치",
  declared_carb_available: "표기 탄수화물 있음",
  kcal_nearby: "열량 차이가 가까움",
};

const TRADEOFF_LABELS: Record<AdvisorTradeoff, string> = {
  brand_recall_history: "브랜드 범위 리콜 이력",
  product_recall_history: "제품 범위 리콜 이력",
};

const UNKNOWN_LABELS: Record<AdvisorUnknown, string> = {
  carb_bound_unspecified: "탄수화물 경계 미확인",
  carb_point_comparison_unavailable:
    "탄수화물은 추정·계산값이므로 우열 판단 제외",
  carb_unknown: "탄수화물 미확인",
  kcal_unknown: "열량 미확인",
  protein_bound_unspecified: "단백질 경계 미확인",
  protein_unknown: "단백질 미확인",
};

function relationLabel(fact: NutritionFact): string {
  if (fact.evidence.tone === "unknown") return "미확인";
  if (fact.proof === null) return "근거 미확인";
  if (fact.evidence.tone === "derived" || fact.evidence.tone === "estimated") {
    return "우열 판단 제외";
  }
  if (fact.proof.kind !== "quoted") return "경계 미확인";
  if (fact.proof.bound === "minimum") return "최소 보증치";
  if (fact.proof.bound === "maximum") return "최대 보증치";
  return "경계 미확인";
}

function EvidenceMetric({
  fact,
  showRelation = true,
}: {
  fact: NutritionFact;
  showRelation?: boolean;
}) {
  const proofUnavailable = fact.proof === null;
  return (
    <div className="advisor-metric">
      <dt>{fact.label}</dt>
      <dd>
        <strong>{proofUnavailable ? "미확인" : fact.value}</strong>
        <span className="evidence-state" data-tone={fact.evidence.tone}>
          {fact.evidence.label}
        </span>
        {(showRelation || proofUnavailable) && (
          <span className="advisor-relation">{relationLabel(fact)}</span>
        )}
      </dd>
    </div>
  );
}

function CandidateCard({
  candidate,
}: {
  candidate: ReadySelection["candidates"][number];
}) {
  const facts = nutritionFacts(candidate.food, candidate.evidence);
  const kcal = facts.find((fact) => fact.key === "kcal_per_kg")!;
  const protein = facts.find((fact) => fact.key === "protein_pct")!;
  const carb = facts.find((fact) => fact.key === "carb_pct")!;
  const delta =
    candidate.kcalDeltaPct === null
      ? "열량 차이 계산 불가"
      : `현재 대비 열량 ${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 }).format(candidate.kcalDeltaPct)}% 차이`;

  return (
    <article
      className="card advisor-candidate"
      data-food-id={candidate.food.id}
    >
      <header>
        <p className="eyebrow">
          {candidate.food.brands?.name ?? "브랜드 미확인"}
        </p>
        <h3>{candidate.food.product_name}</h3>
        <p className="advisor-delta">{delta}</p>
      </header>

      <dl className="advisor-metrics">
        <EvidenceMetric fact={kcal} showRelation={false} />
        <EvidenceMetric fact={protein} />
        <EvidenceMetric fact={carb} />
      </dl>

      {candidate.matchedReasons.length > 0 && (
        <div className="advisor-annotation">
          <strong>조건과 맞는 점</strong>
          <ul className="advisor-tags">
            {candidate.matchedReasons.map((reason) => (
              <li key={reason}>{REASON_LABELS[reason]}</li>
            ))}
          </ul>
        </div>
      )}

      {candidate.tradeoffs.length > 0 && (
        <div className="advisor-annotation advisor-tradeoffs">
          <strong>함께 확인할 이력</strong>
          <ul>
            {candidate.tradeoffs.map((tradeoff) => (
              <li key={tradeoff}>{TRADEOFF_LABELS[tradeoff]}</li>
            ))}
          </ul>
          <p>
            브랜드 범위 기록은 이 제품·로트의 해당 여부가 확인된 기록이
            아닙니다.
          </p>
        </div>
      )}

      {candidate.unknowns.length > 0 && (
        <div className="advisor-annotation advisor-unknowns">
          <strong>불확실성</strong>
          <ul>
            {candidate.unknowns.map((unknown) => (
              <li key={unknown}>{UNKNOWN_LABELS[unknown]}</li>
            ))}
          </ul>
        </div>
      )}

      <Link
        aria-label={`${candidate.food.product_name} 근거 상세 보기`}
        className="ghost"
        href={`/foods/${candidate.food.id}` as Route}
      >
        근거 상세 보기
      </Link>
    </article>
  );
}

function ExclusionSummary({
  excluded,
}: {
  excluded: ReadySelection["excluded"];
}) {
  return (
    <p className="advisor-exclusions">
      제조 방식 불일치 {excluded.cookingMethod}개 · 표기 탄수화물 조건{" "}
      {excluded.declaredCarb}개 · 열량 미확인 {excluded.kcalMissing}개 · 열량
      범위 밖 {excluded.kcalOutsideRange}개
    </p>
  );
}

function AdvisorContent({ state }: { state: AdvisorViewState }) {
  if (state.kind === "empty") {
    return (
      <div className="card advisor-message" data-testid="advisor-empty">
        <h2>현재 사료를 선택해 시작하세요</h2>
        <p>선택한 조건을 공개 근거에 적용해 최대 3개의 후보를 정렬합니다.</p>
      </div>
    );
  }
  if (state.kind === "invalid_query") {
    return (
      <div className="err" role="alert">
        유효한 현재 사료를 선택해야 후보를 찾을 수 있습니다.
      </div>
    );
  }
  if (state.kind === "data_unavailable") {
    return (
      <div className="err" role="alert">
        공개 근거 데이터를 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.
      </div>
    );
  }
  if (state.kind === "current_food_not_found") {
    return (
      <div className="err" role="alert">
        선택한 현재 사료를 공개 카탈로그에서 찾을 수 없습니다.
      </div>
    );
  }

  if (state.selection.candidates.length === 0) {
    return (
      <div className="card advisor-message">
        <p className="eyebrow">현재 사료: {state.currentFood.product_name}</p>
        <h2>조건을 충족한 후보가 없습니다</h2>
        <ExclusionSummary excluded={state.selection.excluded} />
      </div>
    );
  }

  const hasEvidenceBackedKcal = state.selection.candidates.some(
    (candidate) => candidate.kcalDeltaPct !== null,
  );

  return (
    <>
      <header className="advisor-results-header">
        <p className="eyebrow">현재 사료: {state.currentFood.product_name}</p>
        <h2>근거를 확인할 다음 후보</h2>
        <p>
          {hasEvidenceBackedKcal
            ? "근거가 확인된 열량 차이가 가까운 순서이며, 계산할 수 없는 후보는 뒤에서 카탈로그 ID 순서로 표시합니다."
            : "열량 차이를 계산할 수 없어 카탈로그 ID 순서로 표시합니다."}
        </p>
      </header>
      <div className="advisor-candidates">
        {state.selection.candidates.map((candidate) => (
          <CandidateCard candidate={candidate} key={candidate.food.id} />
        ))}
      </div>
    </>
  );
}

export function AdvisorResults({ state }: { state: AdvisorViewState }) {
  return (
    <section aria-label="사료 후보 결과" className="advisor-results">
      <AdvisorContent state={state} />
      <aside className="notice advisor-disclosure">
        원재료·그레인프리·육분프리 조건은 평가하지 않습니다. 건강 상태나 종합
        품질을 판단하거나 안전성을 보증하는 결과가 아닙니다.
      </aside>
    </section>
  );
}
