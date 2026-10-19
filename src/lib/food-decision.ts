import { z } from "zod";
import { adequacyProofSchema, type AdequacyProof } from "./adequacy-evidence";
import type { FoodWithBrand, Ingredient, NutrientEvidence } from "./catalog";
import { findMatchingNutrientEvidence } from "./nutrient-evidence";
import { classifyNutrientBound } from "./advisor";
import {
  deriveIngredientForm,
  deriveIngredientSpecificity,
} from "./ingredient-form";

export const PREFERENCE_LABELS = {
  poultry: "가금육",
  chicken: "닭고기",
  turkey: "칠면조",
  duck: "오리",
  beef: "소고기",
  lamb: "양고기",
  fish: "생선",
} as const;
export type ProteinPreference = keyof typeof PREFERENCE_LABELS;

export const EXCLUSION_LABELS = {
  chicken: "닭고기",
  turkey: "칠면조",
  duck: "오리",
  beef: "소고기",
  lamb: "양고기",
  fish: "생선",
  grain: "곡물",
} as const;
export type IngredientExclusion = keyof typeof EXCLUSION_LABELS;
export const exclusionSchema = z.enum([
  "chicken",
  "turkey",
  "duck",
  "beef",
  "lamb",
  "fish",
  "grain",
]);
export const decisionRequestSchema = z.object({
  question: z.string().trim().max(1200),
  changeReason: z.string().trim().max(160).default(""),
  catName: z.string().trim().max(60),
  currentFoodId: z.number().int().nonnegative().nullable(),
  manualCurrentName: z.string().trim().max(160),
  manualKcal: z.number().finite().min(500).max(10000).nullable(),
  exclusions: z.array(exclusionSchema).max(7),
  preferredProteins: z
    .array(
      z.enum(["poultry", "chicken", "turkey", "duck", "beef", "lamb", "fish"]),
    )
    .max(7)
    .default([]),
  maxKcalDeltaPct: z.number().finite().min(0).max(100).nullable(),
  notHigherKcal: z.boolean().default(false),
  poultryFirst: z.boolean().default(false),
  pendingClarifications: z
    .array(z.enum(["calories", "poultry"]))
    .max(2)
    .default([]),
  adultNonPrescription: z.boolean(),
  unresolvedRequirements: z.array(z.string().max(500)).max(24).default([]),
  ignoredRequirements: z.array(z.string().max(500)).max(24).default([]),
  scopeConcern: z.boolean().default(false),
});
export type DecisionRequest = z.input<typeof decisionRequestSchema>;
export const DEFAULT_DECISION_REQUEST: DecisionRequest = {
  question: "",
  catName: "",
  currentFoodId: null,
  manualCurrentName: "",
  manualKcal: null,
  exclusions: [],
  maxKcalDeltaPct: 10,
  adultNonPrescription: false,
};
const safeUrl = z
  .string()
  .url()
  .refine((v) => /^https?:\/\//.test(v));
export const ingredientEvidenceSchema = z.object({
  excerpt: z.string(),
  capturedAt: z.string(),
  url: safeUrl,
});
export type IngredientProof = z.infer<typeof ingredientEvidenceSchema>;
const evidenceSchema = z.object({
  nutrient_key: z.enum([
    "protein_pct",
    "fat_pct",
    "fiber_pct",
    "ash_pct",
    "moisture_pct",
    "calcium_pct",
    "phosphorus_pct",
    "kcal_per_kg",
    "carb_pct",
    "energy_p_pct",
    "energy_f_pct",
    "energy_c_pct",
  ]),
  value: z.number().finite(),
  excerpt: z.string(),
  captured_at: z.string(),
  source: z.object({ url: safeUrl, capture_method: z.string() }),
});
const conditionSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["met", "failed", "unknown"]),
  detail: z.string(),
});
const labelFactSchema = z.object({
  key: z.enum(["protein_pct", "fat_pct"]),
  value: z.number().finite(),
  bound: z.enum(["minimum", "maximum", "unspecified"]),
  proof: evidenceSchema,
});
type LabelFact = z.infer<typeof labelFactSchema>;
export type DecisionCondition = z.infer<typeof conditionSchema>;
const candidateSchema = z.object({
  preference: z
    .object({
      status: z.enum(["preferred", "other", "unknown", "not_requested"]),
      detail: z.string(),
    })
    .default({
      status: "not_requested",
      detail: "선호 원료를 정하지 않았습니다.",
    }),
  food: z.object({
    id: z.number().int(),
    product_name: z.string(),
    brand: z.string(),
    kcal_per_kg: z.number().finite().nullable(),
    protein_pct: z.number().finite().nullable(),
    fat_pct: z.number().finite().nullable(),
    carb_pct: z.number().finite().nullable(),
    ingredients: z.array(
      z.object({ name: z.string(), position: z.number().int() }),
    ),
  }),
  kcalDeltaPct: z.number().finite().nullable(),
  conditions: z.array(conditionSchema),
  questions: z.array(z.string()),
  evidence: z.array(evidenceSchema),
  ingredientEvidence: ingredientEvidenceSchema.nullable(),
  notes: z.array(z.string()),
  labelFacts: z.array(labelFactSchema).default([]),
  adequacy: z.array(adequacyProofSchema).default([]),
});
export type DecisionCandidate = z.infer<typeof candidateSchema>;
const reportSchema = z.object({
  createdAt: z.string(),
  adequacyUnavailable: z.boolean().default(false),
  ingredientEvidenceUnavailable: z.boolean().default(false),
  request: decisionRequestSchema,
  status: z.enum([
    "ready",
    "outside_scope",
    "baseline_missing",
    "conditions_missing",
  ]),
  baseline: z.object({
    name: z.string(),
    kcal: z.number().finite().nullable(),
    origin: z.enum(["catalog", "owner", "unknown"]),
    evidence: evidenceSchema.nullable(),
    labelFacts: z.array(labelFactSchema).default([]),
    adequacy: z.array(adequacyProofSchema).default([]),
  }),
  eligible: z.array(candidateSchema),
  unresolved: z.array(candidateSchema),
  excluded: z.array(candidateSchema),
  sensitivity: z.array(
    z.object({ maxKcalDeltaPct: z.number(), eligibleCount: z.number().int() }),
  ),
});
export type DecisionReport = z.infer<typeof reportSchema>;
export const decisionSnapshotSchema = z.object({
  version: z.literal(1),
  report: reportSchema,
  selectedFoodId: z.number().int().nullable(),
  reason: z.string().max(1000),
});
export type DecisionSnapshot = z.infer<typeof decisionSnapshotSchema>;

const MATCHERS: Record<IngredientExclusion, RegExp> = {
  chicken: /\bchicken(?:meal|fat|oil)?\b|닭|계육|계지방/i,
  turkey: /\bturkey(?:meal|fat|oil)?\b|칠면조/i,
  duck: /\bduck(?:meal|fat|oil)?\b|오리/i,
  beef: /\b(?:beef|bovine)(?:meal|fat|oil)?\b|소고기|쇠고기|우육|우지/i,
  lamb: /\b(?:lamb|mutton)(?:meal|fat|oil)?\b|양고기|양육/i,
  fish: /\b(?:fish|salmon|tuna|trout|cod|herring|sardine|anchovy|mackerel|hake|pollock|whitefish|menhaden|flounder|halibut|sole|carp|tilapia|sea\s*bass)(?:meal|oil)?\b|생선|어류|어분|어유|연어|참치|송어|대구|청어|정어리|멸치|고등어|명태|가자미|광어|넙치|잉어|농어/i,
  grain:
    /\b(?:grains?|cereals?|rice|wheat|barley|oats?|corn|maize|rye|millet|sorghum|spelt)(?:meal|flour|bran)?\b|곡물|곡류|쌀|현미|백미|통밀|밀기울|밀배아|밀가루|보리|귀리|옥수수|호밀|수수|기장|^밀(?:$|\s|분|단백|글루텐|전분)/i,
};
const GENERIC_ANIMAL =
  /\b(?:animal|meat|digest)(?:meal|fat|oil|digest)?\b|\bnatural\s+flavou?rs?\b|육류|동물성|천연향미|가수분해\s*단백/i;
const GENERIC_POULTRY = /\b(?:poultry|fowl)(?:meal|fat|oil)?\b|가금/i;
const UNSPECIFIED_DERIVATIVE =
  /^(?:(?:hydroly[sz]ed|dried|dehydrated|natural)\s+)*(?:protein|fat|oil|flavou?r|flavou?ring|stock|broth)s?$|^가수분해\s*단백질?$|^단백질$|^지방$/i;

function isUnspecifiedAnimal(name: string): boolean {
  return (
    GENERIC_ANIMAL.test(name) ||
    UNSPECIFIED_DERIVATIVE.test(name.trim()) ||
    (/\b(?:liver|blood|heart|organ|offal|kidney|bone|plasma)\b|내장|혈분|골분|혈장|^간$/i.test(
      name,
    ) &&
      !Object.entries(MATCHERS).some(
        ([family, matcher]) => family !== "grain" && matcher.test(name),
      ))
  );
}

function assessPreference(
  ingredients: readonly Ingredient[],
  proof: IngredientProof | null,
  preferences: readonly ProteinPreference[],
): DecisionCandidate["preference"] {
  if (!preferences.length)
    return {
      status: "not_requested",
      detail: "선호 원료를 정하지 않았습니다.",
    };
  if (!proof)
    return {
      status: "unknown",
      detail: "전체 원재료 근거가 없어 선호 원료의 표기를 확인하지 못했습니다.",
    };
  for (const ingredient of ingredients) {
    const mainName = ingredient.name
      .split(/[（(]/, 1)[0]!
      .replace(/\b(?:preserved|stabilized)\b.*$/i, "")
      .trim();
    const includesTissue =
      /\b(?:meat|meal|liver|heart|kidney|organ|offal|protein)\b|고기|육분|생육|내장|단백|간(?:\s|$)/i.test(
        mainName,
      );
    if (
      !includesTissue &&
      (/^(?:(?:fresh|raw|whole|rendered|dried|dehydrated)\s+)*(?:[\p{L}-]+\s+){0,2}(?:fats?|oils?|tallow|lard|broth|stock|flavou?rs?)$|^(?:신선한\s*|생\s*)?(?:닭|칠면조|오리|소|돼지|연어|생선|동물성|가금류)?\s*(?:지방|우지|돈지|계지|어유|육수|향미)$/iu.test(
        mainName,
      ) ||
        ((Object.entries(MATCHERS).some(
          ([family, matcher]) => family !== "grain" && matcher.test(mainName),
        ) ||
          GENERIC_ANIMAL.test(mainName) ||
          GENERIC_POULTRY.test(mainName)) &&
          /^(?:(?:fresh|raw|whole|rendered|dried|dehydrated)\s+)*[a-z]+(?:fat|oil)$/i.test(
            mainName,
          )))
    )
      continue;
    const otherBird = /\b(?:goose|quail|pheasant)\b|거위|메추리|꿩/i.test(
      ingredient.name,
    );
    const family =
      (["chicken", "turkey", "duck", "beef", "lamb", "fish"] as const).find(
        (key) => MATCHERS[key].test(ingredient.name),
      ) ??
      (otherBird || GENERIC_POULTRY.test(ingredient.name) ? "poultry" : null);
    if (!family && isUnspecifiedAnimal(ingredient.name))
      return {
        status: "unknown",
        detail: `앞선 동물성 표기 “${ingredient.name}”의 종류를 확인해야 합니다.`,
      };
    if (!family && deriveIngredientSpecificity(ingredient.name) !== "species") {
      if (
        /^(?:(?:dried|ground|whole|brown|white|dehydrated)\s+)*(?:peas?|potatoes|potato|rice|corn|maize|wheat|oats?|barley|lentils?|chickpeas?|beans?|soy|beet|pumpkin|carrot|tomato|apple|cranberries|blueberries|flaxseed|sunflower|kelp|chicory|yeast|cellulose|salt|taurine|vitamins?|minerals?|tocopherols?)(?:\s+(?:protein|flour|meal|starch|fiber|fibre|root|pulp|pomace|extract))*$|^(?:완두콩?|감자|쌀|옥수수|보리|귀리|렌틸|병아리콩|대두|비트|호박|당근|토마토|사과|크랜베리|블루베리|아마씨|해바라기|다시마|치커리|효모|셀룰로오스|소금|타우린|비타민|미네랄)(?:\s*(?:단백질|분말|전분|섬유질|추출물))*$/i.test(
          mainName,
        )
      )
        continue;
      return {
        status: "unknown",
        detail: `앞선 원재료 “${ingredient.name}”의 유래를 분류하지 못해 뒤의 원료로 선호 일치를 판단하지 않았습니다.`,
      };
    }
    const requestedBird = preferences.some((key) =>
      ["chicken", "turkey", "duck"].includes(key),
    );
    if (
      family === "poultry" &&
      !otherBird &&
      requestedBird &&
      !preferences.includes("poultry")
    )
      return {
        status: "unknown",
        detail: `“${ingredient.name}”은 가금육의 종을 밝히지 않았습니다.`,
      };
    const matched =
      family !== null &&
      (preferences.includes(family) ||
        (preferences.includes("poultry") &&
          ["chicken", "turkey", "duck"].includes(family)));
    const form = deriveIngredientForm(ingredient.name);
    const formText = {
      fresh: "생육 표기",
      dried: "건조 표기",
      meal: "육분·분말 표기",
      by_product: "부산물 표기",
      unspecified: "형태 미확인",
    }[form];
    return {
      status: matched ? "preferred" : "other",
      detail: `지방·오일·육수 표기를 제외하고 처음 확인한 동물성 원재료는 ${ingredient.position}번째 “${ingredient.name}”입니다 (${formText}). ${matched ? "선호한 원료의 표기와 맞습니다." : "선호한 원료와 다르지만 제외 조건에 걸리지 않으면 후보로 남깁니다."} 기호성이나 육류 함량 비율을 뜻하지 않습니다.`,
    };
  }
  return {
    status: "unknown",
    detail: "선호 원료와 대조할 동물성 원재료의 종류를 확인하지 못했습니다.",
  };
}

export function assessIngredientExclusion(
  ingredients: readonly Ingredient[],
  exclusion: IngredientExclusion,
  hasProof: boolean,
): DecisionCondition {
  const label = `${EXCLUSION_LABELS[exclusion]} 표기 제외`;
  const matches = ingredients.filter((i) => MATCHERS[exclusion].test(i.name));
  if (matches.length)
    return {
      key: exclusion,
      label,
      status: "failed",
      detail: `표기된 원재료: ${matches.map((i) => i.name).join(", ")}`,
    };
  const broad = ingredients.filter(
    (i) =>
      exclusion !== "grain" &&
      (isUnspecifiedAnimal(i.name) ||
        (["chicken", "turkey", "duck"].includes(exclusion) &&
          GENERIC_POULTRY.test(i.name))),
  );
  if (!hasProof || ingredients.length === 0 || broad.length)
    return {
      key: exclusion,
      label,
      status: "unknown",
      detail: broad.length
        ? `종을 확인할 수 없는 표기: ${broad.map((i) => i.name).join(", ")}`
        : "현재 원재료 목록과 일치하는 전체 출처를 확인하지 못했습니다.",
    };
  return {
    key: exclusion,
    label,
    status: "met",
    detail:
      "확인한 원재료 목록에서 해당 표기를 찾지 못했습니다. 혼입이나 알레르기 안전성을 뜻하지는 않습니다.",
  };
}

export function isClinicalDecisionQuestion(question: string): boolean {
  return /처방|신장|신부전|당뇨|췌장|요로|결석|질환|질병|심장병|심근|갑상선|간질환|장염|레날|유리너리|인테스티널|HCM|CKD|IBD|알레르기\s*(?:치료|진단)|키튼|자묘|새끼\s*고양이|아기\s*고양이|성장기|\d+\s*주령|\d+\s*(?:weeks?\s*old|주\s*(?:된|짜리))|생후\s*(?:[0-9]|1[01])\s*개월|\b(?:[0-9]|1[01])\s*개월\s*(?:령|된|짜리|고양이|이에요|입니다)|임신|수유|kitten|babycat|prescription|renal|kidney|urinary|intestinal|hepatic|cardiac|thyroid|\b(?:liver|heart)[\s-]+(?:disease|care|diet|support)\b|diabet|pregnan|lactat/i.test(
    question,
  );
}

function hasCompleteIngredientProof(
  ingredients: readonly Ingredient[],
  proof: IngredientProof | undefined,
): boolean {
  if (!proof || !ingredients.length) return false;
  const normalize = (v: string) =>
    v.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  const text = normalize(proof.excerpt);
  let cursor = 0;
  for (const ingredient of ingredients) {
    const name = normalize(ingredient.name);
    if (!name) return false;
    const at = text.indexOf(name, cursor);
    if (
      at < 0 ||
      !(cursor === 0 ? /^\s*$/ : /^\s*[,;]\s*$/).test(text.slice(cursor, at))
    )
      return false;
    cursor = at + name.length;
  }
  return /^\s*[.,;]?\s*$/.test(text.slice(cursor));
}

export interface DecisionCatalog {
  ingredientEvidenceUnavailable?: boolean;
  adequacyUnavailable?: boolean;
  adequacyByFoodId?: Readonly<Record<number, readonly AdequacyProof[]>>;
  foods: readonly FoodWithBrand[];
  evidenceByFoodId: ReadonlyMap<number, readonly NutrientEvidence[]>;
  ingredientEvidenceByFoodId: Readonly<Record<number, IngredientProof>>;
}

function labelFacts(
  food: FoodWithBrand,
  evidence: readonly NutrientEvidence[],
): LabelFact[] {
  return (["protein_pct", "fat_pct"] as const).flatMap((key) => {
    const source = food.nutrient_sources[key];
    const proof = findMatchingNutrientEvidence(evidence, key, food[key]);
    if (
      !proof ||
      food[key] === null ||
      (source !== "manufacturer" && source !== "kr_label")
    )
      return [];
    return [
      {
        key,
        value: food[key],
        bound: classifyNutrientBound(proof.excerpt),
        proof: { ...proof, source: { ...proof.source } },
      },
    ];
  });
}

export function buildFoodDecision(
  catalog: DecisionCatalog,
  input: DecisionRequest,
  createdAt = new Date().toISOString(),
): DecisionReport {
  const request = decisionRequestSchema.parse(input);
  const current = catalog.foods.find((f) => f.id === request.currentFoodId);
  const manualName =
    request.currentFoodId === null ? request.manualCurrentName : "";
  const manualKcal = request.currentFoodId === null ? request.manualKcal : null;
  const currentEvidence = current
    ? findMatchingNutrientEvidence(
        catalog.evidenceByFoodId.get(current.id) ?? [],
        "kcal_per_kg",
        current.kcal_per_kg,
      )
    : null;
  const baseline: DecisionReport["baseline"] = current
    ? {
        name: `${current.brands?.name ?? ""} ${current.product_name}`.trim(),
        kcal: currentEvidence ? current.kcal_per_kg : null,
        origin: "catalog",
        adequacy: structuredClone([
          ...(catalog.adequacyByFoodId?.[current.id] ?? []),
        ]),
        evidence: currentEvidence,
        labelFacts: labelFacts(
          current,
          catalog.evidenceByFoodId.get(current.id) ?? [],
        ),
      }
    : {
        name: manualName || "현재 사료 미입력",
        kcal: manualKcal,
        origin: manualName ? "owner" : "unknown",
        evidence: null,
        labelFacts: [],
        adequacy: [],
      };
  const report: DecisionReport = {
    createdAt,
    adequacyUnavailable: catalog.adequacyUnavailable ?? false,
    ingredientEvidenceUnavailable:
      catalog.ingredientEvidenceUnavailable ?? false,
    request,
    baseline,
    status: "ready",
    eligible: [],
    unresolved: [],
    excluded: [],
    sensitivity: [],
  };
  if (
    !request.adultNonPrescription ||
    request.scopeConcern ||
    isClinicalDecisionQuestion(request.question)
  )
    return { ...report, status: "outside_scope" };
  if (!current && !manualName) return { ...report, status: "baseline_missing" };
  if (
    !request.exclusions.length &&
    request.maxKcalDeltaPct === null &&
    !request.notHigherKcal &&
    !request.poultryFirst &&
    !request.preferredProteins.length &&
    !request.unresolvedRequirements.length &&
    !request.pendingClarifications.length
  )
    return { ...report, status: "conditions_missing" };
  const candidates = catalog.foods
    .filter(
      (f) =>
        f.id !== current?.id &&
        !isClinicalDecisionQuestion(
          `${f.brands?.name ?? ""} ${f.product_name}`,
        ),
    )
    .map((food): DecisionCandidate => {
      const evidence = (catalog.evidenceByFoodId.get(food.id) ?? []).filter(
        (e) =>
          findMatchingNutrientEvidence(
            [e],
            e.nutrient_key,
            food[e.nutrient_key],
          ) !== null,
      );
      const kcalProof = findMatchingNutrientEvidence(
        evidence,
        "kcal_per_kg",
        food.kcal_per_kg,
      );
      const kcalDeltaPct =
        baseline.kcal && kcalProof && food.kcal_per_kg !== null
          ? ((food.kcal_per_kg - baseline.kcal) / baseline.kcal) * 100
          : null;
      const rawIngredientProof = catalog.ingredientEvidenceByFoodId[food.id];
      const ingredientEvidence = hasCompleteIngredientProof(
        food.ingredients,
        rawIngredientProof,
      )
        ? rawIngredientProof!
        : null;
      const conditions = request.exclusions.map((e) =>
        assessIngredientExclusion(
          food.ingredients,
          e,
          ingredientEvidence !== null,
        ),
      );
      for (const key of request.pendingClarifications)
        conditions.push({
          key: `clarify-${key}`,
          label:
            key === "calories"
              ? "열량 기준 확인"
              : "가금육 선호의 비교 기준 확인",
          status: "unknown",
          detail:
            "질문 아래의 확인 항목에서 이번 비교 기준을 먼저 확정해 주세요.",
        });
      if (request.poultryFirst) {
        const poultry = food.ingredients.find(
          (i) =>
            MATCHERS.chicken.test(i.name) ||
            MATCHERS.turkey.test(i.name) ||
            MATCHERS.duck.test(i.name) ||
            GENERIC_POULTRY.test(i.name),
        );
        const fish = food.ingredients.find((i) => MATCHERS.fish.test(i.name));
        const ambiguous = food.ingredients.some((i) =>
          isUnspecifiedAnimal(i.name),
        );
        conditions.push({
          key: "poultry-first",
          label: "가금육이 생선보다 먼저 표기",
          status:
            !ingredientEvidence || ambiguous
              ? "unknown"
              : poultry && (!fish || poultry.position < fish.position)
                ? "met"
                : "failed",
          detail:
            !ingredientEvidence || ambiguous
              ? "전체 원재료 근거나 동물성 원료의 종류를 확인해야 합니다."
              : `가금육: ${poultry ? `${poultry.position}번째 ${poultry.name}` : "표기 없음"} · 생선: ${fish ? `${fish.position}번째 ${fish.name}` : "표기 없음"}. 기호성과 함량 비율을 예측하지 않습니다.`,
        });
      }
      for (const [
        index,
        requirement,
      ] of request.unresolvedRequirements.entries())
        conditions.push({
          key: `unsupported-${index}`,
          label: "질문 중 확인하지 못한 조건",
          status: "unknown",
          detail: requirement,
        });
      if (request.maxKcalDeltaPct !== null)
        conditions.push({
          key: "kcal",
          label: `열량 차이 ${request.maxKcalDeltaPct}% 이내`,
          status:
            kcalDeltaPct === null
              ? "unknown"
              : Math.abs(kcalDeltaPct) <= request.maxKcalDeltaPct
                ? "met"
                : "failed",
          detail:
            kcalDeltaPct === null
              ? "현재 사료와 후보의 열량을 같은 kcal/kg 기준으로 확인해야 합니다."
              : `현재 대비 ${kcalDeltaPct > 0 ? "+" : ""}${kcalDeltaPct.toFixed(1)}%`,
        });
      if (request.notHigherKcal)
        conditions.push({
          key: "kcal-ceiling",
          label: "현재 사료보다 높지 않은 열량",
          status:
            kcalDeltaPct === null
              ? "unknown"
              : kcalDeltaPct <= 0
                ? "met"
                : "failed",
          detail:
            kcalDeltaPct === null
              ? "두 사료의 열량 근거를 확인해야 합니다."
              : `현재 대비 ${kcalDeltaPct > 0 ? "+" : ""}${kcalDeltaPct.toFixed(1)}%`,
        });
      const questions = conditions
        .filter((c) => c.status === "unknown")
        .map((c) =>
          c.key.startsWith("unsupported-") || c.key.startsWith("clarify-")
            ? c.detail
            : c.key === "poultry-first"
              ? "전체 원재료에서 가금육과 생선의 표기 순서 및 종 미상 동물성 원료를 확인해 주세요."
              : c.key === "kcal" || c.key === "kcal-ceiling"
                ? `포장 또는 제조사 자료에서 ${baseline.kcal === null ? "현재 사료와 " : ""}이 제품의 열량(kcal/kg) 표기를 확인할 수 있나요?`
                : `제조사 또는 수입사에 ${EXCLUSION_LABELS[c.key as IngredientExclusion]} 유래 원료 여부와 전체 원재료 목록을 확인해 주세요. (${c.detail})`,
        );
      if (!kcalProof && request.maxKcalDeltaPct === null)
        questions.push(
          "열량이 확인되지 않아 급여량의 차이는 판단하지 못했습니다. 포장의 kcal/kg 표기를 확인해 주세요.",
        );
      const notes = [
        "구매 전 포장에서 성묘용 또는 전연령 종합영양식인지, 비교한 제품명·판매 지역과 같은지 확인해 주세요.",
        "보증성분의 최소·최대 표기는 정확한 함량 차이로 해석할 수 없습니다.",
      ];
      if (
        food.nutrient_sources.carb_pct === "estimated" ||
        food.nutrient_sources.carb_pct === "derived"
      )
        notes.push(
          "탄수화물은 추정·계산값이므로 선택 순위를 정하는 데 사용하지 않았습니다.",
        );
      if (baseline.origin === "owner")
        notes.push(
          "열량 차이는 직접 입력한 현재 사료 값을 기준으로 계산했습니다.",
        );
      if ((food.recalls?.length ?? 0) > 0)
        notes.push(
          "연결된 리콜 이력이 있습니다. 제품·브랜드 범위와 대상 로트를 원문에서 확인해 주세요.",
        );
      return {
        preference: assessPreference(
          food.ingredients,
          ingredientEvidence,
          request.preferredProteins,
        ),
        food: {
          id: food.id,
          product_name: food.product_name,
          brand: food.brands?.name ?? "브랜드 미확인",
          kcal_per_kg: kcalProof ? food.kcal_per_kg : null,
          protein_pct: food.protein_pct,
          fat_pct: food.fat_pct,
          carb_pct: food.carb_pct,
          ingredients: food.ingredients.map((i) => ({ ...i })),
        },
        kcalDeltaPct,
        conditions,
        questions,
        evidence: evidence.map((e) => ({ ...e, source: { ...e.source } })),
        ingredientEvidence: ingredientEvidence
          ? { ...ingredientEvidence }
          : null,
        notes,
        labelFacts: labelFacts(food, evidence),
        adequacy: structuredClone([
          ...(catalog.adequacyByFoodId?.[food.id] ?? []),
        ]),
      };
    });
  candidates.sort(
    (a, b) =>
      ({ preferred: 0, other: 1, unknown: 2, not_requested: 0 })[
        a.preference.status
      ] -
        { preferred: 0, other: 1, unknown: 2, not_requested: 0 }[
          b.preference.status
        ] ||
      Math.abs(a.kcalDeltaPct ?? Infinity) -
        Math.abs(b.kcalDeltaPct ?? Infinity) ||
      a.food.id - b.food.id,
  );
  for (const candidate of candidates) {
    if (candidate.conditions.some((c) => c.status === "failed"))
      report.excluded.push(candidate);
    else if (candidate.conditions.some((c) => c.status === "unknown"))
      report.unresolved.push(candidate);
    else report.eligible.push(candidate);
  }
  report.sensitivity = [5, 10, 15].map((limit) => ({
    maxKcalDeltaPct: limit,
    eligibleCount: candidates.filter(
      (c) =>
        c.kcalDeltaPct !== null &&
        Math.abs(c.kcalDeltaPct) <= limit &&
        c.conditions
          .filter((x) => x.key !== "kcal" && x.key !== "clarify-calories")
          .every((x) => x.status === "met"),
    ).length,
  }));
  return report;
}

export function exportDecisionBrief(snapshot: DecisionSnapshot): string {
  const { report } = snapshot;
  const selected = [...report.eligible, ...report.unresolved].find(
    (c) => c.food.id === snapshot.selectedFoodId,
  );
  return [
    "# 다음 사료 검토 기록",
    `검토 시각: ${report.createdAt}`,
    ...(report.ingredientEvidenceUnavailable
      ? [
          "원재료 근거 자료: 이 검토에서는 불러오지 못했습니다. 원재료 조건의 출처를 다시 확인해야 합니다.",
        ]
      : []),
    ...(report.adequacyUnavailable
      ? [
          "제조사 선언 자료: 이 검토에서는 불러오지 못했습니다. 선언이 없거나 영양기준에 미달한다는 뜻은 아닙니다.",
        ]
      : []),
    `질문: ${report.request.question || "입력한 조건으로 비교"}`,
    `바꾸려는 이유: ${report.request.changeReason || "별도 기록 없음"}`,
    `선호 원료: ${report.request.preferredProteins.map((key) => PREFERENCE_LABELS[key]).join(", ") || "없음"} (제외 조건이 아닌 우선순위)`,
    `현재 사료: ${report.baseline.name}`,
    `현재 열량: ${report.baseline.kcal ?? "미확인"} kcal/kg (${report.baseline.origin === "owner" ? "직접 입력" : "카탈로그 근거"})`,
    ...(report.baseline.evidence
      ? [
          `현재 열량 근거: ${report.baseline.evidence.excerpt} (${report.baseline.evidence.captured_at}) ${report.baseline.evidence.source.url}`,
        ]
      : []),
    ...report.baseline.adequacy.map(
      (a) =>
        `현재 사료 제조사 선언: ${a.statement} (${a.capturedAt}) ${a.url} — 판매 지역·현재 포장 미확인`,
    ),
    `선택한 후보: ${selected ? `${selected.food.brand} ${selected.food.product_name}` : "아직 선택하지 않음"}`,
    `선택 또는 보류 이유: ${snapshot.reason || "미기록"}`,
    ...report.baseline.labelFacts.map(
      (f) =>
        `현재 사료 ${f.key === "protein_pct" ? "단백질" : "지방"}: ${f.value}% (${f.bound === "minimum" ? "최소 보증치" : f.bound === "maximum" ? "최대 보증치" : "경계 미확인"}) — ${f.proof.excerpt} ${f.proof.source.url}`,
    ),
    `요청한 원재료 제외: ${report.request.exclusions.map((x) => EXCLUSION_LABELS[x]).join(", ") || "없음"}`,
    `허용 열량 차이: ${report.request.maxKcalDeltaPct === null ? "제한 없음" : `${report.request.maxKcalDeltaPct}% 이내`}`,
    `현재 열량 이하 조건: ${report.request.notHigherKcal ? "적용" : "미적용"}`,
    `가금육이 생선보다 먼저 표기된 조건: ${report.request.poultryFirst ? "적용 (기호성 예측 아님)" : "미적용"}`,
    ...report.request.ignoredRequirements.map(
      (r) => `사용자가 이번 비교 범위에서 제외한 요구: ${r}`,
    ),
    ...report.eligible
      .concat(report.unresolved, report.excluded)
      .map((c) =>
        [
          `\n## ${c.food.brand} ${c.food.product_name}`,
          `- 선호 원료 확인: ${c.preference.detail}`,
          ...c.conditions.map(
            (x) =>
              `- ${x.label}: ${x.status === "met" ? "표기 기준 충족" : x.status === "failed" ? "불충족" : "확인 필요"} — ${x.detail}`,
          ),
          ...c.questions.map((q) => `- 다음 확인: ${q}`),
          ...c.evidence.map(
            (e) => `- 근거: ${e.excerpt} (${e.captured_at}) ${e.source.url}`,
          ),
          ...(c.ingredientEvidence
            ? [
                `- 원재료 근거: ${c.ingredientEvidence.excerpt} (${c.ingredientEvidence.capturedAt}) ${c.ingredientEvidence.url}`,
              ]
            : []),
          ...c.adequacy.map(
            (a) =>
              `- 제조사 선언: ${a.standard} / ${a.lifeStage} / ${a.method} — ${a.statement} (${a.capturedAt}) ${a.url} — 판매 지역·현재 포장 미확인`,
          ),
          ...c.notes.map((n) => `- ${n}`),
        ].join("\n"),
      ),
    "\n이 기록은 저장 당시의 비교입니다. 현재 포장의 제품명·판매 지역·원재료를 구매 전에 다시 확인해 주세요. 건강 적합성이나 알레르기 안전성을 보증하지 않습니다.",
  ].join("\n\n");
}
