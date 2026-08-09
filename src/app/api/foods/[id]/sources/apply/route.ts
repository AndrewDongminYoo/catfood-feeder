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
    // 다만 상태 코드는 갈라야 한다. RPC가 근거를 거절한 것은 요청이 틀린 것이지
    // 서버가 고장난 것이 아니다. 500으로 뭉뚱그리면 호출자는 재시도해야 할 장애로
    // 읽고, 조사 스크립트의 집계에서도 "거절"이 "실패"로 둔갑한다 — g/kg 를 %로
    // 읽은 제안 두 건이 그렇게 장애로 보고됐다.
    if (isEvidenceRefusal(error)) {
      return NextResponse.json(
        { error: "근거가 검증을 통과하지 못했습니다." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Draft 적용에 실패했습니다." },
      { status: 500 },
    );
  }
}

/**
 * RPC가 근거를 거절한 것인가, 아니면 진짜 장애인가.
 *
 * apply_food_evidence_draft 는 검증 실패를 RAISE EXCEPTION 으로 알린다. 문구로
 * 가르는 것은 취약하지만, 대안은 RPC 반환 규약을 바꾸는 것이고 그쪽이 훨씬 넓은
 * 변경이다. 모르는 문구는 500으로 남겨 두는 쪽이 안전하다 — 장애를 거절로 감추는
 * 것보다 거절을 장애로 보고하는 편이 낫다.
 */
function isEvidenceRefusal(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return [
    "Evidence excerpt is absent from source",
    "Evidence value is absent from its excerpt",
    "Evidence values violate catalog domain rules",
    "Evidence values must use numeric",
    "Each evidence item requires",
  ].some((refusal) => message.includes(refusal));
}
