import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import {
  RequestBodyTooLargeError,
  SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "@/lib/request-body";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import { extractCapturedSources } from "@/lib/source-extraction";
import {
  foodExists,
  getCurrentFetchedFoodSources,
} from "@/lib/source-repository";

const requestSchema = z
  .object({ sourceIds: z.array(z.number().int().positive()).min(1).max(2) })
  .strict();

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied") {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }
  if (authorization.origin === "automation") {
    return NextResponse.json(
      { error: "자동화 자격 증명으로는 원문 추출을 실행할 수 없습니다." },
      { status: 403 },
    );
  }
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
    if (
      !parsed.success ||
      new Set(parsed.data.sourceIds).size !== parsed.data.sourceIds.length
    ) {
      return NextResponse.json(
        { error: "추출할 출처 ID가 올바르지 않습니다." },
        { status: 400 },
      );
    }
    // 할당량은 DB 조회보다 먼저 차감한다. 뒤에 두면 foodExists/getCurrentFetchedFoodSources가
    // 무제한 존재 여부 오라클이 된다.
    const rateLimit = await consumeRateLimit(
      `extract:${authorization.rateLimitKey}`,
    );
    if (!rateLimit.allowed)
      return NextResponse.json(
        { error: "추출 요청 한도를 초과했습니다." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    if (!(await foodExists(foodId.data)))
      return NextResponse.json(
        { error: "대상 사료를 찾을 수 없습니다." },
        { status: 404 },
      );

    const sources = await getCurrentFetchedFoodSources(
      foodId.data,
      parsed.data.sourceIds,
    );
    if (
      sources.length !== parsed.data.sourceIds.length ||
      new Set(sources.map((source) => source.kind)).size !== sources.length
    ) {
      return NextResponse.json(
        {
          error: "현재 수집 완료된 제조사·국내 라벨 출처만 선택할 수 있습니다.",
        },
        { status: 400 },
      );
    }
    const result = await extractCapturedSources(sources);
    if (result.kind === "success")
      return NextResponse.json({ candidates: result.candidates });
    const errors = {
      api_error: "Claude API 추출에 실패했습니다.",
      configuration_error: "ANTHROPIC_API_KEY 미설정",
      invalid_response: "Claude JSON 응답 형식 오류",
      timeout: "Claude API 요청 시간이 초과되었습니다.",
    } as const;
    return NextResponse.json(
      { error: errors[result.code] },
      { status: result.code === "timeout" ? 504 : 502 },
    );
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
    return NextResponse.json(
      { error: "출처 추출에 실패했습니다." },
      { status: 500 },
    );
  }
}
