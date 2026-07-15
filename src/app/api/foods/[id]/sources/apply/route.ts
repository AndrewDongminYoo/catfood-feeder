import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import { validateExtractedEvidence } from "@/lib/source-extraction";
import {
  applyFoodEvidenceDraft,
  foodExists,
  getCurrentFetchedFoodSources,
} from "@/lib/source-repository";

const nutrientKeySchema = z.enum([
  "protein_pct",
  "fat_pct",
  "fiber_pct",
  "ash_pct",
  "moisture_pct",
  "calcium_pct",
  "phosphorus_pct",
  "kcal_per_kg",
]);
const requestSchema = z
  .object({
    evidence: z
      .array(
        z.object({
          excerpt: z.string().min(1),
          nutrientKey: nutrientKeySchema,
          sourceId: z.number().int().positive(),
          value: z.number().finite(),
        }),
      )
      .min(1)
      .max(8),
  })
  .strict();

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied")
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  if (authorization.origin === "automation")
    return NextResponse.json(
      { error: "자동화 자격 증명으로는 Draft를 적용할 수 없습니다." },
      { status: 403 },
    );
  const foodId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await context.params).id);
  if (!foodId.success)
    return NextResponse.json(
      { error: "사료 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json(
        { error: "Draft 적용 요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    if (!(await foodExists(foodId.data)))
      return NextResponse.json(
        { error: "대상 사료를 찾을 수 없습니다." },
        { status: 404 },
      );
    const sources = await getCurrentFetchedFoodSources(foodId.data, [
      ...new Set(parsed.data.evidence.map((item) => item.sourceId)),
    ]);
    const evidence = validateExtractedEvidence(parsed.data.evidence, sources);
    if (evidence.length !== parsed.data.evidence.length)
      return NextResponse.json(
        { error: "근거 문구 또는 출처가 현재 수집본과 일치하지 않습니다." },
        { status: 400 },
      );
    await applyFoodEvidenceDraft(foodId.data, evidence);
    return NextResponse.json({ evidence });
  } catch {
    return NextResponse.json(
      { error: "Draft 적용에 실패했습니다." },
      { status: 500 },
    );
  }
}
