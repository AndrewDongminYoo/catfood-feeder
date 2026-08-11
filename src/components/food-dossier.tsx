import type { FoodWithBrand } from "@/lib/catalog";
import { type EvidenceTone, nutritionFacts } from "@/lib/catalog-presentation";
import { RecallHistory } from "./recall-history";

export function FoodDossier({ food }: { food: FoodWithBrand }) {
  const facts = nutritionFacts(food);
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
            <div className="dossier-fact" key={fact.key}>
              <div>
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
              </div>
              <EvidenceState
                label={fact.evidence.label}
                tone={fact.evidence.tone}
              />
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
