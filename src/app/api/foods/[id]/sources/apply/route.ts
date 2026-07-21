import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import {
  RequestBodyTooLargeError,
  SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "@/lib/request-body";
import { evidenceCandidateSchema } from "@/lib/source-apply";
import { validateExtractedEvidence } from "@/lib/source-extraction";
import {
  applyFoodEvidenceDraft,
  foodExists,
  getCurrentFetchedFoodSources,
} from "@/lib/source-repository";

const requestSchema = z
  .object({
    evidence: z.array(evidenceCandidateSchema).min(1).max(8),
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
    const parsed = requestSchema.safeParse(
      await readJsonBody(req, SMALL_JSON_BODY_BYTES),
    );
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
    const results = await applyFoodEvidenceDraft(foodId.data, evidence);
    return NextResponse.json({ results });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError)
      return NextResponse.json(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "요청 JSON 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    // RPC의 구체적 거부 사유(근거 문구 불일치, 출처 불일치)는 클라이언트에 노출하지
    // 않되 서버 로그에는 남긴다. 스키마 드리프트와 일시적 장애를 구분하려면 필요하다.
    console.error("applyFoodEvidenceDraft failed", error);
    return NextResponse.json(
      { error: "Draft 적용에 실패했습니다." },
      { status: 500 },
    );
  }
}
