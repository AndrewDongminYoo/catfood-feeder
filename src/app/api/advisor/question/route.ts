import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  buildQuestionPrompt,
  parseDecisionQuestion,
  validateQuestionProposal,
} from "@/lib/decision-question";
import { proposeDecisionConditions } from "@/lib/source-extraction";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";
const requestSchema = z
  .object({ question: z.string().trim().min(1).max(1200) })
  .strict();

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json(
      { error: "이 화면에서 질문을 다시 입력해 주세요." },
      { status: 403 },
    );
  }
  try {
    const input = requestSchema.safeParse(await readJsonBody(req, 8192));
    if (!input.success)
      return NextResponse.json(
        { error: "질문을 1,200자 이내로 입력해 주세요." },
        { status: 400 },
      );
    const fallback = parseDecisionQuestion(input.data.question);
    if (fallback.outsideScope)
      return NextResponse.json({ interpretation: fallback, mode: "rules" });
    try {
      // 인스턴스별 메모리나 임의 IP를 신뢰하지 않고 사이트 전체의 유료 호출을 제한한다.
      const quota = await consumeRateLimit(
        "decision-question:daily:v1",
        30,
        86_400_000,
      );
      if (quota.allowed) {
        const interpretation = validateQuestionProposal(
          await proposeDecisionConditions(
            buildQuestionPrompt(input.data.question),
          ),
          input.data.question,
        );
        if (interpretation)
          return NextResponse.json({ interpretation, mode: "ai" });
      }
    } catch {
      /* 질문과 조건을 유지하는 구조화 입력으로 이어진다. */
    }
    return NextResponse.json({
      interpretation: fallback,
      mode: "rules",
      notice:
        "질문에서 읽은 조건을 표시했습니다. 빠진 조건은 아래에서 직접 선택해 주세요.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "질문을 읽지 못했습니다. 입력을 확인하고 다시 시도해 주세요." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
}
