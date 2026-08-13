import Link from "next/link";
import type { FoodWithBrand } from "@/lib/catalog";
import { type EvidenceTone, nutritionFacts } from "@/lib/catalog-presentation";
import { RecallHistory } from "./recall-history";

export function FoodComparison({ foods }: { foods: readonly FoodWithBrand[] }) {
  if (foods.length !== 2) {
    return (
      <p className="empty">
        두 제품을 선택하세요. <Link href="/foods">카탈로그로 이동</Link>
      </p>
    );
  }

  const factsByFood = foods.map((food) => ({
    facts: nutritionFacts(food),
    food,
  }));
  const needsEvidenceNote = factsByFood.some(({ facts }) =>
    facts.some((fact) => fact.evidence.tone !== "declared"),
  );

  return (
    <section className="comparison" aria-labelledby="comparison-heading">
      <header className="comparison-header">
        <h2 id="comparison-heading">차이를 확인하세요</h2>
        <p>
          수치와 근거 상태를 나란히 보고, 무엇을 더 확인할지 정할 수 있습니다.
        </p>
      </header>

      <div className="comparison-matrix">
        {factsByFood.map(({ facts, food }) => (
          <article className="comparison-column" key={food.id}>
            <header>
              <p className="eyebrow">{food.brands?.name ?? "브랜드 미기록"}</p>
              <h3>{food.product_name}</h3>
            </header>
            <dl className="comparison-facts">
              {facts.map((fact) => (
                <div className="comparison-cell" key={fact.key}>
                  <dt>{fact.label}</dt>
                  <dd>
                    <strong>{fact.value}</strong>
                    <EvidenceState
                      label={fact.evidence.label}
                      tone={fact.evidence.tone}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>

      <section className="comparison-notes">
        <h3>함께 볼 점</h3>
        <ul>
          <li>
            표기값은 보증성분의 최소/최대값을 포함할 수 있어 실제 함량이나
            정밀한 점값을 뜻하지 않습니다.
          </li>
          <li>열량 구성은 생애주기와 신체 상태를 함께 고려해 읽으세요.</li>
          <li>Ca:P는 높고 낮음보다 비율 자체를 확인할 지표입니다.</li>
          {needsEvidenceNote && (
            <li>계산값, 추정값, 미기록 항목은 근거 상태와 함께 확인하세요.</li>
          )}
        </ul>
      </section>

      <section className="comparison-context">
        {foods.map((food) => (
          <article className="comparison-context-card" key={food.id}>
            <h3>{food.product_name}의 원재료와 이력</h3>
            <div className="chips">
              {food.ingredients.map((ingredient, index) => (
                <span key={`${ingredient.name}-${index}`}>
                  {ingredient.name}
                  {ingredient.pct !== null ? ` ${ingredient.pct}%` : ""}
                </span>
              ))}
              {food.ingredients.length === 0 && <span>원재료 미기록</span>}
            </div>
            <RecallHistory recalls={food.recalls ?? []} />
            <p className="learning-note">
              연결된 기록은 공개 이력의 범위이며 실시간 경보가 아닙니다. 연결된
              기록이 없더라도 국내 리콜 이력이 없다는 뜻은 아닙니다.
            </p>
          </article>
        ))}
      </section>
    </section>
  );
}

function EvidenceState({ label, tone }: { label: string; tone: EvidenceTone }) {
  return (
    <span className="evidence-state" data-tone={tone}>
      {label}
    </span>
  );
}
