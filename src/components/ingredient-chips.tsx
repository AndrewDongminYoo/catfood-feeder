import type { Ingredient } from "@/lib/catalog";
import {
  type IngredientForm,
  deriveIngredientForm,
} from "@/lib/ingredient-form";

/**
 * 형태 표기는 라벨이 명시한 값이 아니라 이름에서 파생한 것이므로, 이름과 시각적으로
 * 구분해 둔다. 실측과 추정을 섞지 않는 이 프로젝트의 규칙이 원재료에도 그대로 적용된다.
 */
const FORM_LABELS: Partial<Record<IngredientForm, string>> = {
  by_product: "부산물",
  dried: "건조",
  fresh: "생",
  meal: "분말",
};

export function IngredientChips({
  ingredients,
}: {
  ingredients: readonly Ingredient[];
}) {
  if (ingredients.length === 0)
    return (
      <div className="chips">
        <span>원재료 미기록</span>
      </div>
    );

  return (
    <div className="chips">
      {/* 순서가 이 데이터의 값이다. 저장 순서를 믿지 않고 position 으로 다시 세운다. */}
      {[...ingredients]
        .sort((left, right) => left.position - right.position)
        .map((ingredient) => {
          const form = FORM_LABELS[deriveIngredientForm(ingredient.name)];
          return (
            <span
              data-testid="ingredient-chip"
              key={`${ingredient.position}-${ingredient.name}`}
            >
              {ingredient.name}
              {form && <em className="ingredient-form">{form}</em>}
            </span>
          );
        })}
    </div>
  );
}
