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
