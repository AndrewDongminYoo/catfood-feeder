import { z } from "zod";
import { extractAdequacyDeclarations } from "./food-adequacy.ts";

export const adequacyApplySchema = z
  .object({
    sourceId: z.number().int().positive(),
    statement: z.string().trim().min(20).max(1200),
    sourceProductName: z.string().trim().min(3).max(350),
    sourceContentHash: z.string().min(1).max(128),
  })
  .strict();
export type AdequacyApply = z.infer<typeof adequacyApplySchema>;
export const adequacyProofSchema = z.object({
  statement: z.string().max(1200),
  sourceProductName: z.string(),
  standard: z.enum(["AAFCO", "FEDIAF", "unspecified"]),
  method: z.enum([
    "formulation",
    "feeding_trial",
    "product_family",
    "unspecified",
  ]),
  lifeStage: z.enum([
    "adult_maintenance",
    "growth",
    "growth_reproduction",
    "growth_maintenance",
    "all_life_stages",
    "unspecified",
  ]),
  capturedAt: z.string(),
  url: z
    .string()
    .url()
    .refine((url) => /^https:\/\//.test(url)),
  appliedByOrigin: z.enum(["human", "automation"]),
  salesMarket: z.null(),
  currentPackageVerified: z.literal(false),
});
export type AdequacyProof = z.infer<typeof adequacyProofSchema>;
const normalize = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, " ").trim();
export function validateAdequacyCapture(
  foodId: number,
  draft: AdequacyApply,
  source: {
    food_id: number;
    kind: string;
    is_current: boolean;
    fetch_status: string;
    content_hash: string | null;
    captured_at: string | null;
    captured_text: string | null;
  },
): boolean {
  if (
    source.food_id !== foodId ||
    source.kind !== "manufacturer" ||
    !source.is_current ||
    source.fetch_status !== "fetched" ||
    !source.captured_at ||
    source.content_hash !== draft.sourceContentHash ||
    !source.captured_text
  )
    return false;
  const found = extractAdequacyDeclarations(source.captured_text);
  return (
    found.length === 1 &&
    found[0].species !== "dog" &&
    normalize(found[0].statement) === normalize(draft.statement) &&
    normalize(draft.statement).includes(normalize(draft.sourceProductName))
  );
}
export function projectAdequacy(row: {
  statement: string;
  source_product_name: string;
  captured_at: string;
  applied_by_origin: string;
  food_sources: { url: string };
}): AdequacyProof | null {
  const found = extractAdequacyDeclarations(row.statement);
  if (found.length !== 1 || found[0].species === "dog") return null;
  const parsed = adequacyProofSchema.safeParse({
    ...found[0],
    statement: row.statement,
    sourceProductName: row.source_product_name,
    capturedAt: row.captured_at,
    url: row.food_sources.url,
    appliedByOrigin: row.applied_by_origin,
    salesMarket: null,
    currentPackageVerified: false,
  });
  return parsed.success ? parsed.data : null;
}
