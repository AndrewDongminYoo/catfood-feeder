import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import { detectSourceConflicts, parseManufacturerEnergy } from "@/lib/domain";
import { RequestBodyTooLargeError, readJsonBody } from "@/lib/request-body";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import {
  extractCapturedSources,
  toManualExtraction,
} from "@/lib/source-extraction";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 30_000;
const extractionRequestSchema = z
  .object({
    manufacturerText: z.string().max(MAX_TEXT_LENGTH).default(""),
    krLabelText: z.string().max(MAX_TEXT_LENGTH).default(""),
  })
  .strict();

export async function POST(req: NextRequest) {
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
  try {
    // consumeRateLimit은 Supabase 설정 누락/RPC 실패 시 throw한다. try 안에서 호출해야
    // 다른 모든 경로와 같은 JSON 오류 계약을 유지한다.
    const rateLimit = await consumeRateLimit(
      `extract:${authorization.rateLimitKey}`,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "추출 요청 한도를 초과했습니다." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const request = extractionRequestSchema.safeParse(
      await readJsonBody(req, MAX_BODY_BYTES),
    );
    if (!request.success)
      return NextResponse.json(
        { error: "요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    const sources = [
      request.data.manufacturerText
        ? {
            capturedText: request.data.manufacturerText,
            id: 1,
            kind: "manufacturer" as const,
          }
        : null,
      request.data.krLabelText
        ? {
            capturedText: request.data.krLabelText,
            id: 2,
            kind: "kr_label" as const,
          }
        : null,
    ].filter(
      (
        source,
      ): source is {
        readonly capturedText: string;
        readonly id: number;
        readonly kind: "manufacturer" | "kr_label";
      } => source !== null,
    );
    if (sources.length === 0)
      return NextResponse.json(
        { error: "원문이 비어 있습니다." },
        { status: 400 },
      );

    const result = await extractCapturedSources(sources);
    if (result.kind === "failure") return extractionFailure(result.code);
    return NextResponse.json({
      conflicts: detectSourceConflicts(
        request.data.manufacturerText,
        request.data.krLabelText,
      ),
      mfgEnergy: parseManufacturerEnergy(request.data.manufacturerText),
      parsed: toManualExtraction(result, sources),
    });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError)
      return NextResponse.json(
        { error: "원문은 64KB 이하로 입력해 주세요." },
        { status: 413 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "요청 JSON 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    return NextResponse.json({ error: "추출 요청 처리 실패" }, { status: 500 });
  }
}

function extractionFailure(
  code: "api_error" | "configuration_error" | "invalid_response" | "timeout",
) {
  switch (code) {
    case "api_error":
      return NextResponse.json(
        { error: "Claude API 추출에 실패했습니다." },
        { status: 502 },
      );
    case "configuration_error":
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY 미설정" },
        { status: 500 },
      );
    case "invalid_response":
      return NextResponse.json(
        { error: "Claude JSON 응답 형식 오류" },
        { status: 502 },
      );
    case "timeout":
      return NextResponse.json(
        { error: "Claude API 요청 시간이 초과되었습니다." },
        { status: 504 },
      );
  }
}
