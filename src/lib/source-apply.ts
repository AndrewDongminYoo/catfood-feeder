import { z } from "zod";

export const nutrientKeySchema = z.enum([
  "protein_pct",
  "fat_pct",
  "fiber_pct",
  "ash_pct",
  "moisture_pct",
  "calcium_pct",
  "phosphorus_pct",
  "kcal_per_kg",
  // 한국 등록성분량이 NFE를 직접 쓰는 경우의 실측 탄수화물.
  "carb_pct",
]);

export const evidenceCandidateSchema = z.object({
  excerpt: z.string().min(1).max(500),
  nutrientKey: nutrientKeySchema,
  sourceId: z.number().int().positive(),
  value: z.number().finite().nonnegative(),
});

export const evidenceApplyResultSchema = evidenceCandidateSchema.extend({
  status: z.enum(["applied", "skipped", "conflict"]),
});

export const evidenceApplyResponseSchema = z.object({
  results: z.array(evidenceApplyResultSchema),
});

export type EvidenceCandidate = Readonly<
  z.infer<typeof evidenceCandidateSchema>
>;
export type EvidenceApplyResult = Readonly<
  z.infer<typeof evidenceApplyResultSchema>
>;

const databaseEvidenceApplyResultsSchema = z.array(
  z
    .object({
      excerpt: z.string().min(1).max(500),
      nutrient_key: nutrientKeySchema,
      source_id: z.number().int().positive(),
      status: z.enum(["applied", "skipped", "conflict"]),
      value: z.number().finite().nonnegative(),
    })
    .strict(),
);

export function parseEvidenceApplyResults(
  value: unknown,
): readonly EvidenceApplyResult[] {
  return databaseEvidenceApplyResultsSchema.parse(value).map((result) => ({
    excerpt: result.excerpt,
    nutrientKey: result.nutrient_key,
    sourceId: result.source_id,
    status: result.status,
    value: result.value,
  }));
}

export function conflictCandidates(
  results: readonly EvidenceApplyResult[],
): readonly EvidenceCandidate[] {
  return results.flatMap((result) =>
    result.status === "conflict"
      ? [
          {
            excerpt: result.excerpt,
            nutrientKey: result.nutrientKey,
            sourceId: result.sourceId,
            value: result.value,
          },
        ]
      : [],
  );
}

/**
 * 원재료 목록의 적용 요청.
 *
 * 영양소는 값 아홉 개가 각자 충돌하지만 원재료는 목록 하나가 통째로 충돌한다.
 * 그래서 근거도 항목마다가 아니라 목록 하나에 하나 붙는다.
 */
export const ingredientCandidateSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    position: z.number().int().positive(),
  })
  .strict();

/**
 * 배열 순서와 position 이 1..n 으로 맞물리는가.
 *
 * 순서가 이 데이터의 값이므로, 카탈로그에 원재료를 쓰는 두 경로가 같은 규칙을
 * 써야 한다. 조사 경로만 검사하면 큐레이터 경로로 들어온 중복·결번·역순이
 * 그대로 발행된다.
 */
export function hasContiguousPositions(
  ingredients: readonly { readonly position: number }[],
): boolean {
  return ingredients.every(
    (ingredient, index) => ingredient.position === index + 1,
  );
}

export const POSITION_ORDER_MESSAGE =
  "position 은 배열 순서와 같은 1..n 이어야 합니다.";

export const ingredientDraftSchema = z
  .object({
    // 영양소 구절은 한 문구지만 원재료 구절은 문단이다. 상한이 다르다.
    excerpt: z.string().trim().min(1).max(4000),
    ingredients: z.array(ingredientCandidateSchema).min(1).max(200),
    sourceId: z.number().int().positive(),
  })
  .strict()
  // 순서가 이 데이터의 값이므로 RPC 에 닿기 전에 여기서도 막는다. 어긋난 순서가
  // 통과하면 조용히 잘못 정렬된 목록이 발행된다.
  .refine((draft) => hasContiguousPositions(draft.ingredients), {
    message: POSITION_ORDER_MESSAGE,
  });

export type IngredientDraft = Readonly<z.infer<typeof ingredientDraftSchema>>;

export type IngredientApplyResult = Readonly<{
  count: number;
  status: "applied" | "skipped" | "conflict";
}>;

const databaseIngredientApplyResultSchema = z
  .object({
    count: z.number().int().nonnegative(),
    status: z.enum(["applied", "skipped", "conflict"]),
  })
  .strict();

export function parseIngredientApplyResult(
  value: unknown,
): IngredientApplyResult {
  return databaseIngredientApplyResultSchema.parse(value);
}

/**
 * `apply_food_ingredients_draft` 가 검증 거절에 다는 SQLSTATE.
 *
 * 거절과 장애를 문구로 가르면 규칙이 하나 늘 때마다 분류가 조용히 낡는다. 실제로
 * 완전성 검사를 추가하자마자 그 메시지가 목록에서 빠져, 400 이어야 할 응답이
 * 500 이 됐다. 새 RPC 는 계약을 이쪽이 소유하므로 코드로 가른다.
 */
const INGREDIENT_REFUSAL_SQLSTATE = "CFING";

/** RPC 가 근거를 거절한 것인가, 아니면 진짜 장애인가. */
export function isIngredientRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === INGREDIENT_REFUSAL_SQLSTATE
  );
}
