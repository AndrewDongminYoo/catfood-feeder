/**
 * 원재료 이름에서 형태와 특이성을 읽어낸다.
 *
 * 두 축 모두 라벨이 쓴 이름 안에 이미 들어 있다. 저장하면 재추출이 그 해석을 행에
 * 얼어붙이고, 파생하면 규칙이 나아질 때 다시 계산하면 된다. 열량비와 충돌을 모델이
 * 아니라 서버가 계산하는 것과 같은 이유다.
 *
 * 판단할 수 없으면 추측하지 않고 unspecified 를 돌려준다. 규칙이 모르는 표기를
 * 억지로 분류하는 것보다, 모른다고 답하고 나중에 규칙을 늘리는 편이 낫다.
 */

export type IngredientForm =
  "by_product" | "dried" | "fresh" | "meal" | "unspecified";

export type IngredientSpecificity = "category" | "species" | "unspecified";

/**
 * 순서가 곧 우선순위다. 앞의 규칙이 이긴다 — "by-product meal" 은 by_product 다.
 *
 * 한국어 쪽은 확실한 표기만 잡는다. "생선"은 형태가 아니라 종류이고 "생강"은 한
 * 단어이므로, "생"은 뒤에 오는 글자를 확인한 뒤에만 생물로 읽는다.
 */
const FORM_RULES: readonly (readonly [IngredientForm, RegExp])[] = [
  ["by_product", /\bby[-\s]?products?\b|부산물/i],
  ["meal", /\bmeals?\b|\bpowder\b|분말|육분|어분|골분|고기분/i],
  ["dried", /\bdried\b|\bdehydrated\b|말린|건조/i],
  [
    "fresh",
    /\bfresh\b|\braw\b|\bdeboned\b|신선|생육|생\s*(?=통|닭|오리|칠면조|연어|고등어|정어리|대구|양|소|돼지|고기|육)/i,
  ],
];

/** 종을 밝힌 표기. 상위 범주 단어가 같이 있어도 이쪽이 이긴다. */
const SPECIES =
  /\b(?:chicken|turkey|duck|goose|quail|salmon|trout|herring|sardine|anchovy|tuna|mackerel|hake|cod|pollock|lamb|mutton|beef|pork|venison|rabbit|bison|egg)\b|닭|오리|거위|메추리|칠면조|연어|송어|청어|정어리|멸치|참치|고등어|대구|명태|우럭|가자미|양고기|소고기|돼지|사슴|토끼|들소|계란|계육/i;

/** 종을 밝히지 않은 상위 범주. 만든 쪽이 종을 말하지 않았다는 것 자체가 신호다. */
const CATEGORY =
  /\b(?:poultry|meat|fish|animal|marine|fowl)\b|가금|육류|어류|동물성|생선|해산물/i;

export function deriveIngredientForm(name: string): IngredientForm {
  const value = name.trim();
  for (const [form, pattern] of FORM_RULES) {
    if (pattern.test(value)) return form;
  }
  return "unspecified";
}

/**
 * 상위 범주 표기에 함께 붙을 수 있는, 종 이름이 아닌 단어들.
 *
 * 이 목록에 없는 낱말이 남으면 그것이 규칙이 모르는 종 이름일 수 있으므로
 * category 로 단정하지 않는다.
 */
const NOT_A_SPECIES =
  /^(?:and|or|of|with|by|products?|meals?|powder|flour|digest|hydrolyzed|hydrolysed|dried|dehydrated|fresh|raw|deboned|whole|ground|rendered|bone|bones|liver|heart|giblets|organ|organs|fat|oil|broth|protein|isolate|concentrate|poultry|meat|fish|animal|marine|fowl)$/i;

export function deriveIngredientSpecificity(
  name: string,
): IngredientSpecificity {
  const value = name.trim();
  if (SPECIES.test(value)) return "species";
  if (!CATEGORY.test(value)) return "unspecified";

  // 잔여어 검사는 "규칙이 모르는 영어 종 이름이 범주어 옆에 붙어 있는" 모양을
  // 잡으려는 것이다. 한국어 합성어는 낱말로 쪼개지지 않아 이 검사가 성립하지
  // 않으므로, 라틴 문자가 없는 표기에는 적용하지 않는다.
  if (!/[A-Za-z]/.test(value)) return "category";

  // 괄호 안의 함량 표기와 구두점을 걷어내고 남은 낱말을 본다.
  const residual = value
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}]+/u)
    .filter((token) => token.length > 1 && !NOT_A_SPECIES.test(token));

  return residual.length === 0 ? "category" : "unspecified";
}
