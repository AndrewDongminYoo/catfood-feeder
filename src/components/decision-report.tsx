"use client";

import Link from "next/link";
import { AdequacyEvidence } from "./adequacy-evidence";
import type { Route } from "next";
import { useState } from "react";
import type {
  DecisionCandidate,
  DecisionReport as Report,
} from "@/lib/food-decision";

const STATUS_LABEL = {
  met: "표기 기준 충족",
  failed: "조건 불충족",
  unknown: "확인 필요",
};

function LabelComparison({
  current,
  candidate,
}: {
  current: DecisionCandidate["labelFacts"];
  candidate: DecisionCandidate["labelFacts"];
}) {
  return (
    <figure className="decision-label-comparison">
      <figcaption>원문 근거가 있는 보증성분 표기</figcaption>
      <p className="decision-label-scale">
        모든 막대는 0–100% 같은 축으로 표시해요.
      </p>
      {(["protein_pct", "fat_pct"] as const).map((key) => {
        const label = key === "protein_pct" ? "단백질" : "지방";
        const find = (facts: DecisionCandidate["labelFacts"]) =>
          facts.find(
            (fact) =>
              fact.key === key &&
              Number.isFinite(fact.value) &&
              fact.value >= 0 &&
              fact.value <= 100,
          );
        const baselineFact = find(current);
        const candidateFact = find(candidate);
        const direction =
          !baselineFact || !candidateFact
            ? "unknown"
            : candidateFact.value === baselineFact.value
              ? "same"
              : candidateFact.value > baselineFact.value
                ? "higher"
                : "lower";
        const comparison = {
          higher: "후보 표기값 높음",
          lower: "후보 표기값 낮음",
          same: "표기값 같음",
          unknown: "근거 확인 필요",
        }[direction];
        return (
          <section
            className="decision-label-metric"
            aria-label={`${label} 표기 비교`}
            key={key}
          >
            <header>
              <h4>{label}</h4>
              <span
                className="decision-label-direction"
                data-direction={direction}
              >
                <span aria-hidden="true">
                  {direction === "higher"
                    ? "↑ "
                    : direction === "lower"
                      ? "↓ "
                      : direction === "same"
                        ? "= "
                        : ""}
                </span>
                {comparison}
              </span>
            </header>
            {(
              [
                { kind: "current", name: "현재 사료", fact: baselineFact },
                { kind: "candidate", name: "이 후보", fact: candidateFact },
              ] as const
            ).map(({ kind, name, fact }) => (
              <div className="decision-label-row" data-kind={kind} key={kind}>
                <div>
                  <span>{name}</span>
                  <strong>
                    {fact
                      ? `${fact.value}% ${fact.bound === "minimum" ? "이상" : fact.bound === "maximum" ? "이하" : "(경계 미확인)"}`
                      : "근거 미확인"}
                  </strong>
                </div>
                <div
                  className="decision-label-track"
                  data-known={Boolean(fact)}
                  aria-hidden="true"
                >
                  {fact && (
                    <span
                      className="decision-label-fill"
                      style={{ width: `${fact.value}%` }}
                    />
                  )}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </figure>
  );
}

function Candidate({
  candidate,
  baseline,
  adequacyUnavailable,
  onSelect,
}: {
  candidate: DecisionCandidate;
  baseline: Report["baseline"];
  adequacyUnavailable: boolean;
  onSelect: (id: number) => void;
}) {
  const { food } = candidate;
  return (
    <article className="decision-candidate">
      <header>
        <p className="eyebrow">{food.brand}</p>
        <h3>{food.product_name}</h3>
        <div className="decision-energy">
          <span>현재 사료 대비 열량</span>
          <strong>
            {candidate.kcalDeltaPct === null
              ? "비교 보류"
              : `${candidate.kcalDeltaPct >= 0 ? "+" : ""}${candidate.kcalDeltaPct.toFixed(1)}%`}
          </strong>
          <span>
            {food.kcal_per_kg === null
              ? "후보 열량 근거 미확인"
              : `${food.kcal_per_kg.toLocaleString("ko-KR")} kcal/kg`}
          </span>
        </div>
      </header>
      <section className="decision-fit">
        <h4>먼저 살펴볼 이유</h4>
        <p>
          {candidate.preference.status === "preferred"
            ? "선호한 원료의 표기가 먼저 확인됐어요."
            : candidate.preference.status === "other"
              ? "선호한 원료와 다른 후보예요. 제외 조건은 아래에서 따로 확인해 주세요."
              : candidate.preference.status === "unknown"
                ? "선호 원료는 추가 확인이 필요해요. 확인된 비교 조건을 함께 보세요."
                : "확인된 조건과 현재 사료의 차이를 함께 비교할 수 있어요."}
        </p>
        {candidate.preference.status !== "not_requested" && (
          <p>{candidate.preference.detail}</p>
        )}
        <h4>선택할 때 확인할 점</h4>
        <p>
          {candidate.kcalDeltaPct === null
            ? "열량 차이를 확인하지 못해 급여량 차이를 판단할 수 없어요."
            : candidate.kcalDeltaPct === 0
              ? "표기 열량은 같아도 배합과 급여량 안내는 다를 수 있어요."
              : "열량 밀도가 달라 같은 무게를 먹여도 섭취 열량이 달라집니다. 포장의 급여량을 확인해 주세요."}
        </p>
      </section>
      <LabelComparison
        current={baseline.labelFacts}
        candidate={candidate.labelFacts}
      />
      <p className="decision-caption">
        막대와 높낮이는 포장에 적힌 숫자를 비교해요. 최소·최대 보증치이므로 실제
        함량 차이나 품질의 우열을 뜻하지 않아요.
      </p>
      <AdequacyEvidence
        proofs={candidate.adequacy}
        unavailable={adequacyUnavailable}
      />
      <ul className="decision-conditions">
        {candidate.conditions.map((condition) => (
          <li key={condition.key} data-state={condition.status}>
            <strong>
              {condition.label}
              <span>{STATUS_LABEL[condition.status]}</span>
            </strong>
            <p>{condition.detail}</p>
          </li>
        ))}
      </ul>
      {candidate.questions.length > 0 && (
        <section className="decision-questions">
          <h4>선택 전에 풀어야 할 질문</h4>
          <ul>
            {[...new Set(candidate.questions)].map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}
      <details className="decision-evidence">
        <summary>원재료와 판단 근거 펼치기</summary>
        <h4>라벨에 적힌 원재료 순서</h4>
        {food.ingredients.length ? (
          <ol>
            {food.ingredients.map((i) => (
              <li key={`${i.position}-${i.name}`}>{i.name}</li>
            ))}
          </ol>
        ) : (
          <p>원재료 목록을 확인하지 못했습니다.</p>
        )}
        {candidate.ingredientEvidence && (
          <blockquote>
            <p>{candidate.ingredientEvidence.excerpt}</p>
            <a
              href={candidate.ingredientEvidence.url}
              target="_blank"
              rel="noreferrer"
            >
              원재료 원문 보기
            </a>
            <small>
              {candidate.ingredientEvidence.capturedAt.slice(0, 10)} 수집
            </small>
          </blockquote>
        )}
        <h4>현재 수치와 일치하는 근거</h4>
        {candidate.evidence.length ? (
          candidate.evidence.map((e) => (
            <blockquote key={`${e.nutrient_key}-${e.source.url}`}>
              <p>{e.excerpt}</p>
              <a href={e.source.url} target="_blank" rel="noreferrer">
                성분 원문 보기
              </a>
              <small>{e.captured_at.slice(0, 10)} 수집</small>
            </blockquote>
          ))
        ) : (
          <p>현재 수치와 일치하는 원문 근거를 확인하지 못했습니다.</p>
        )}
      </details>
      <details className="decision-evidence">
        <summary>구매 전 확인할 한계</summary>
        <ul className="decision-caveats">
          {candidate.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
      <div className="decision-actions">
        <button
          className="primary"
          type="button"
          onClick={() => onSelect(food.id)}
        >
          이 후보를 검토 기록에 담기
        </button>
        <Link className="ghost" href={`/foods/${food.id}` as Route}>
          제품 상세
        </Link>
        <a
          className="ghost"
          href={`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(`${food.brand} ${food.product_name}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          판매처 검색
        </a>
      </div>
      <p className="decision-caption">
        판매처 검색은 구매 가능한 동일 배합·재고·가격을 확인한 결과가 아닙니다.
      </p>
    </article>
  );
}

function CandidateGroup({
  title,
  description,
  candidates,
  baseline,
  adequacyUnavailable,
  onSelect,
}: {
  title: string;
  description: string;
  candidates: readonly DecisionCandidate[];
  baseline: Report["baseline"];
  adequacyUnavailable: boolean;
  onSelect: (id: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  return (
    <section className="decision-group">
      <header>
        <h2>
          {title}
          <span>{candidates.length}</span>
        </h2>
        <p>{description}</p>
      </header>
      {candidates.length === 0 ? (
        <p className="decision-empty">이 조건에 해당하는 후보가 없습니다.</p>
      ) : (
        <>
          <div className="decision-candidate-grid">
            {(showAll ? candidates : candidates.slice(0, 3)).map((c) => (
              <Candidate
                key={c.food.id}
                candidate={c}
                baseline={baseline}
                adequacyUnavailable={adequacyUnavailable}
                onSelect={onSelect}
              />
            ))}
          </div>
          {candidates.length > 3 && (
            <button
              className="ghost"
              type="button"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll
                ? "처음 3개만 보기"
                : `나머지 ${candidates.length - 3}개 후보 더 보기`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function DecisionReport({
  report,
  historical,
  onSelect,
  onToleranceChange,
  comparisonDisabled = false,
}: {
  report: Report;
  historical: boolean;
  onSelect: (id: number) => void;
  onToleranceChange: (delta: number) => void;
  comparisonDisabled?: boolean;
}) {
  if (report.status === "outside_scope")
    return (
      <section className="card decision-blocked" role="status">
        <h2>성묘의 일반 건사료를 비교하는 범위입니다</h2>
        <p>
          질환·처방식·성장기·임신·수유에 맞는 식단은 이 비교로 정할 수 없습니다.
          담당 수의사에게 급여 조건을 먼저 확인해 주세요.
        </p>
        <p>
          일반 건사료의 표기와 차이를 비교하려면 질문과 위 확인 항목을 수정해
          주세요.
        </p>
      </section>
    );
  if (report.status === "baseline_missing")
    return (
      <section className="card" role="status">
        <h2>비교할 현재 사료를 알려주세요</h2>
        <p>
          목록에서 고르거나 ‘목록에 없는 사료’를 선택해 포장에 적힌 이름을
          입력해 주세요.
        </p>
      </section>
    );
  if (report.status === "conditions_missing")
    return (
      <section className="card" role="status">
        <h2>비교 기준을 먼저 정해주세요</h2>
        <p>
          열량 차이나 원재료 표기 조건을 하나 이상 정해주세요. 조건이 없는
          목록을 질문에 맞는 후보라고 표시하지 않습니다.
        </p>
      </section>
    );
  return (
    <div className="decision-report" aria-label="다음 사료 검토 결과">
      <section className="decision-summary">
        <div>
          <p className="eyebrow">
            {report.request.catName
              ? `${report.request.catName}의 다음 한 봉지`
              : "다음 한 봉지를 위한 검토"}
          </p>
          <h2>
            {report.eligible.length
              ? `먼저 살펴볼 후보 ${Math.min(3, report.eligible.length)}개를 골랐어요`
              : "선택을 막는 정보부터 확인해 보세요"}
          </h2>
          <p>
            기준 사료: <strong>{report.baseline.name}</strong>
          </p>
          <p>
            {report.baseline.kcal === null
              ? "현재 사료 열량 근거 미확인"
              : `${report.baseline.kcal.toLocaleString("ko-KR")} kcal/kg`}
            {report.baseline.origin === "owner" && " · 직접 입력한 값"}
          </p>
          {report.baseline.evidence && (
            <p>
              <a
                className="decision-baseline-source"
                href={report.baseline.evidence.source.url}
                target="_blank"
                rel="noreferrer"
              >
                기준 사료 열량 원문 보기
              </a>{" "}
              · {report.baseline.evidence.captured_at.slice(0, 10)} 수집
            </p>
          )}
        </div>
        <dl>
          <div>
            <dt>비교 후보</dt>
            <dd>{report.eligible.length}</dd>
          </div>
          <div>
            <dt>추가 확인</dt>
            <dd>{report.unresolved.length}</dd>
          </div>
          <div>
            <dt>조건 불충족</dt>
            <dd>{report.excluded.length}</dd>
          </div>
        </dl>
        <p className="decision-caption">
          {historical
            ? "저장 당시의 자료입니다. 현재 자료로 다시 비교하기 전까지 이 결과는 바뀌지 않습니다."
            : `${report.createdAt.slice(0, 10)} 조회 자료 기준입니다.`}{" "}
          조건 충족은 건강 적합성이나 종합 품질의 판정이 아닙니다.
        </p>
      </section>
      {report.ingredientEvidenceUnavailable && (
        <section className="card" role="status">
          <p>
            원재료 근거 자료를 불러오지 못했어요. 원재료 조건을 확인하려면 현재
            자료로 다시 비교해 주세요.
          </p>
        </section>
      )}
      <CandidateGroup
        baseline={report.baseline}
        adequacyUnavailable={report.adequacyUnavailable}
        title="먼저 비교할 후보"
        description="선호한 원료의 표기가 확인된 후보를 먼저, 그 안에서는 현재와 열량 차이가 작은 순서로 보여드립니다. 선호와 달라도 필수 조건을 통과하면 후보로 남깁니다. 건강이나 품질 순위가 아닙니다."
        candidates={report.eligible}
        onSelect={onSelect}
      />
      <details className="card decision-sensitivity">
        <summary>열량 기준을 바꾸며 더 비교하기</summary>
        <section>
          <h2>열량 허용 폭을 바꾸면 선택지가 얼마나 달라질까요?</h2>
          <p>
            원재료 조건을 유지한 채 열량 차이의 허용 폭만 바꿔 봤습니다.
            생물학적 효과나 성공 확률을 계산한 값이 아닙니다.
          </p>
          <div>
            {report.sensitivity.map((s) => (
              <button
                type="button"
                key={s.maxKcalDeltaPct}
                className="ghost"
                disabled={historical || comparisonDisabled}
                onClick={() =>
                  onToleranceChange(s.maxKcalDeltaPct as 5 | 10 | 15)
                }
              >
                <span>{s.maxKcalDeltaPct}% 이내</span>
                <strong>{s.eligibleCount}개</strong>
                <small>이 조건으로 다시 비교</small>
              </button>
            ))}
          </div>
        </section>
      </details>
      {report.unresolved.length > 0 && (
        <details className="card decision-more">
          <summary>
            자료를 더 확인하면 비교할 수 있는 후보 {report.unresolved.length}개
          </summary>
          <CandidateGroup
            baseline={report.baseline}
            adequacyUnavailable={report.adequacyUnavailable}
            title="확인하면 선택지가 될 수 있는 후보"
            description="조건을 완화하지 않았습니다. 아래 질문에 답할 자료가 생기면 다시 비교할 수 있습니다."
            candidates={report.unresolved}
            onSelect={onSelect}
          />
        </details>
      )}
      {report.excluded.length > 0 && (
        <details className="card decision-excluded">
          <summary>
            조건이 맞지 않은 {report.excluded.length}개 제품과 이유
          </summary>
          <ul>
            {report.excluded.map((c) => (
              <li key={c.food.id}>
                <strong>
                  {c.food.brand} {c.food.product_name}
                </strong>
                <p>
                  {c.conditions
                    .filter((x) => x.status === "failed")
                    .map((x) => `${x.label}: ${x.detail}`)
                    .join(" / ")}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
