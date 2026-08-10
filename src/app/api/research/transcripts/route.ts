import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NUTRIENT_KEYS } from "@/lib/domain";
import { authorizeResearchAgent } from "@/lib/research-auth";
import { recordFoodResearchRun } from "@/lib/research-repository";
import {
  RequestBodyTooLargeError,
  TRANSCRIPT_JSON_BODY_BYTES,
  readJsonBody,
} from "@/lib/request-body";
import { isPublicHttpUrl } from "@/lib/source-collection";

/**
 * 이미지 라벨의 전사 제안을 원장에 적는다. **값도 출처도 쓰지 않는다.**
 *
 * 전사본은 기계가 쓴 글이라 그 안에서 구절을 검증하면 자기가 쓴 것을 자기가 대조하는
 * 순환이 된다. 그래서 이 경로는 제안까지만 하고, 실제 저장은 운영자가 이미지와
 * 나란히 확인한 뒤 사람 세션으로 `/api/foods/:id/sources`(manual)를 부를 때 일어난다.
 * 상태는 호출자가 정할 수 없다 — 언제나 pending_review 다.
 */
const requestSchema = z
  .object({
    agent: z
      .object({
        model: z.string().min(1),
        name: z.string().min(1),
        promptVersion: z.string().min(1),
        schemaVersion: z.string().min(1),
      })
      .strict(),
    foodId: z.number().int().positive(),
    images: z
      .array(
        z
          .object({ contentHash: z.string().min(1), url: z.string().url() })
          .strict(),
      )
      .min(1),
    productPageUrl: z.string().url(),
    transcript: z.string().min(1).max(20_000),
    values: z
      .array(
        z
          .object({
            excerpt: z.string().min(1).max(500),
            nutrientKey: z.enum(NUTRIENT_KEYS),
            value: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      // 값이 하나도 없는 제안은 승인할 수 없다. 승인 경로는 manual 출처를 먼저
      // 등록한 뒤 근거를 적용하는데, 근거 라우트는 최소 1건을 요구하므로 400이
      // 돌아오고 근거 없는 출처만 미아로 남는다.
      .min(1),
  })
  .strict()
  .superRefine((body, ctx) => {
    // 에이전트가 제출한 URL이다 — javascript:, data:, file:, ftp: 를 그대로
    // 받으면 안 된다. 형제 라우트(research-proposal.ts)와 같은 판정을 쓴다.
    if (!isPublicHttpUrl(body.productPageUrl)) {
      ctx.addIssue({
        code: "custom",
        message: "Only public HTTPS URLs are accepted",
        path: ["productPageUrl"],
      });
    }
    for (const [index, image] of body.images.entries()) {
      if (!isPublicHttpUrl(image.url)) {
        ctx.addIssue({
          code: "custom",
          message: "Only public HTTPS URLs are accepted",
          path: ["images", index, "url"],
        });
      }
    }
    // 프롬프트가 찾는 표(사료등록성분/등록성분량/보장성분)는 한 페이지에 여러 번
    // 인쇄되는 경우가 흔해 모델이 같은 nutrientKey를 두 번 낼 수 있다. 여기서
    // 막지 않으면 validateExtractedEvidence가 뒤엣것을 조용히 버리고, apply가
    // 그 길이 불일치를 400으로 되돌려 이미 등록된 manual 출처를 미아로 남긴다.
    const nutrientKeys = new Set<string>();
    for (const [index, value] of body.values.entries()) {
      if (nutrientKeys.has(value.nutrientKey)) {
        ctx.addIssue({
          code: "custom",
          message: "Each nutrient key may appear at most once",
          path: ["values", index, "nutrientKey"],
        });
      }
      nutrientKeys.add(value.nutrientKey);
    }
  });

export async function POST(req: NextRequest) {
  const authorization = authorizeResearchAgent(req);
  if (authorization.kind === "denied") {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }

  try {
    const parsed = requestSchema.safeParse(
      await readJsonBody(req, TRANSCRIPT_JSON_BODY_BYTES),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "전사 제안 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const runId = await recordFoodResearchRun({
      agent: parsed.data.agent,
      captures: {
        images: parsed.data.images,
        productPageUrl: parsed.data.productPageUrl,
      },
      evidenceResults: [],
      foodId: parsed.data.foodId,
      proposal: {
        transcript: parsed.data.transcript,
        values: parsed.data.values,
      },
      status: "pending_review",
    });

    return NextResponse.json({ runId });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413 },
      );
    }
    console.error("transcript proposal failed", error);
    return NextResponse.json(
      { error: "전사 제안 적재에 실패했습니다." },
      { status: 500 },
    );
  }
}
