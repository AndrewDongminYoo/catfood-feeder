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
      .default([]),
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
