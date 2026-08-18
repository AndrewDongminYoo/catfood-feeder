import type { FoodWithBrand, NutrientEvidence } from "@/lib/catalog";
import {
  type EvidenceTone,
  type NutritionProof,
  type NutritionProofInput,
  type QuotedProof,
  nutritionFacts,
} from "@/lib/catalog-presentation";
import { matchExcerptValue, normalizeExcerpt } from "@/lib/excerpt-match";
import { RecallHistory } from "./recall-history";

export function FoodDossier({
  evidence = [],
  food,
}: {
  evidence?: readonly NutrientEvidence[];
  food: FoodWithBrand;
}) {
  const facts = nutritionFacts(food, evidence);
  const unknownFacts = facts.filter((fact) => fact.evidence.tone === "unknown");

  return (
    <div className="dossier-grid">
      <section className="card dossier-section">
        <h2>균형을 읽는 법</h2>
        <p className="learning-note">
          표기값은 보증성분의 최소/최대값을 포함할 수 있어 실제 함량이나 정밀한
          점값을 뜻하지 않습니다.
        </p>
        <div className="dossier-facts">
          {facts.map((fact) => (
            // 주의 문구는 summary 밖에 둔다 — summary 의 콘텐츠 모델은 phrasing
            // content 이고, 안에 두면 접힌 상태에서도 펼침 컨트롤의 이름에 섞인다.
            <div className="dossier-fact" key={fact.key}>
              {fact.proof ? (
                <details>
                  <summary>
                    <FactHead
                      evidence={fact.evidence}
                      label={fact.label}
                      value={fact.value}
                    />
                  </summary>
                  <ProofDetail proof={fact.proof} />
                </details>
              ) : (
                <FactHead
                  evidence={fact.evidence}
                  label={fact.label}
                  value={fact.value}
                />
              )}
              {fact.note && <p className="learning-note">{fact.note}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="card dossier-section">
        <h2>원재료와 다음 질문</h2>
        <div className="chips">
          {food.ingredients.map((ingredient, index) => (
            <span key={`${ingredient.name}-${index}`}>
              {ingredient.name}
              {ingredient.pct !== null ? ` ${ingredient.pct}%` : ""}
            </span>
          ))}
          {food.ingredients.length === 0 && <span>원재료 미기록</span>}
        </div>
        <p className="learning-note">
          원재료 한 가지나 마케팅 표현만으로 품질을 단정할 수 없습니다.
        </p>
      </section>

      <section className="card dossier-section">
        <h2>근거와 미확인 항목</h2>
        <p className="learning-note">
          각 수치는 기록된 근거 상태와 함께 읽어야 합니다.
        </p>
        <ul className="evidence-list">
          {facts.map((fact) => (
            <li key={fact.key}>
              <span>{fact.label}</span>
              <EvidenceState
                label={fact.evidence.label}
                tone={fact.evidence.tone}
              />
            </li>
          ))}
        </ul>
        {unknownFacts.length > 0 && (
          <div className="unknown-list">
            <strong>확인 필요</strong>
            <ul>
              {unknownFacts.map((fact) => (
                <li key={fact.key}>{fact.label}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card dossier-section">
        <h2>리콜 이력의 범위</h2>
        <RecallHistory recalls={food.recalls ?? []} />
        <p className="notice">
          이 목록은 연결된 공개 리콜 이력의 범위만 보여 줍니다. 실시간 경보가
          아니며 연결된 기록이 없더라도 국내 리콜 이력이 없다는 뜻은 아닙니다.
        </p>
      </section>
    </div>
  );
}

function EvidenceState({ label, tone }: { label: string; tone: EvidenceTone }) {
  return (
    <span className="evidence-state" data-tone={tone}>
      {label}
    </span>
  );
}

function captureMethodLabel(method: string) {
  if (method === "manual") return "수동 입력";
  if (method === "fetch") return "자동 수집";
  return method;
}

function FactHead({
  evidence,
  label,
  value,
}: {
  evidence: { label: string; tone: EvidenceTone };
  label: string;
  value: string;
}) {
  return (
    <>
      {/* summary 의 콘텐츠 모델은 phrasing content 다 — 이 래퍼가 div 이면
          비준수라 펼침 컨트롤의 이름 계산이 브라우저 오류 복구에 의존한다.
          그리드 아이템이라 span 이어도 블록으로 배치된다. */}
      <span className="fact-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </span>
      <EvidenceState label={evidence.label} tone={evidence.tone} />
    </>
  );
}

// 매치가 없으면 원문을 그대로가 아니라 정규화한 문자열로 그린다 — 매치가 있을 때
// 그리는 조각도 정규화된 문자열에서 잘라낸 것이라, 그러지 않으면 한 화면에 서로
// 다른 정규화가 섞인다.
function ProofQuote({ excerpt, value }: { excerpt: string; value: number }) {
  const marked = matchExcerptValue(excerpt, value);
  if (!marked)
    return (
      <blockquote className="proof-quote">
        {normalizeExcerpt(excerpt)}
      </blockquote>
    );
  return (
    <blockquote className="proof-quote">
      {marked.before}
      <mark>{marked.match}</mark>
      {marked.after}
    </blockquote>
  );
}

function QuotedProofDetail({ proof }: { proof: QuotedProof }) {
  return (
    <>
      <ProofQuote excerpt={proof.excerpt} value={proof.value} />
      <p className="learning-note">
        <a href={proof.url} rel="noreferrer" target="_blank">
          원문 보기
        </a>
        {" · "}
        {new Date(proof.capturedAt).toLocaleDateString("ko-KR")} 수집 ·{" "}
        {captureMethodLabel(proof.captureMethod)}
      </p>
    </>
  );
}

// 수식만으로는 "무엇에서 계산했는지"가 검증되지 않는다. 각 항을 그 항의 인용문까지
// 펼칠 수 있게 하되, 인용할 근거가 없는 항(익스트루전 회분 폴백)은 빈 펼침 대신
// 배지만 달린 줄로 남긴다.
function ProofInput({ input }: { input: NutritionProofInput }) {
  const head = (
    <FactHead
      evidence={input.evidence}
      label={input.label}
      value={input.value}
    />
  );
  if (!input.proof) return <div className="proof-input">{head}</div>;
  return (
    <details>
      <summary>{head}</summary>
      <QuotedProofDetail proof={input.proof} />
    </details>
  );
}

function ProofDetail({ proof }: { proof: NutritionProof }) {
  if (proof.kind === "computed") {
    return (
      <>
        <p className="learning-note">{proof.formula}</p>
        <div className="proof-inputs">
          {proof.inputs.map((input) => (
            <ProofInput input={input} key={input.key} />
          ))}
        </div>
      </>
    );
  }
  return <QuotedProofDetail proof={proof} />;
}
