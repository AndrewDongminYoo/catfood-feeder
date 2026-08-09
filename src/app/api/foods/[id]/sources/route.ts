import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import {
  RequestBodyTooLargeError,
  TRANSCRIPT_JSON_BODY_BYTES,
  formatBodyLimit,
  readJsonBody,
} from "@/lib/request-body";
import {
  SOURCE_CAPTURE_METHOD_VALUES,
  SOURCE_KIND_VALUES,
  hashSourceText,
  isPublicHttpUrl,
} from "@/lib/source-collection";
import { captureSource } from "@/lib/source-fetcher";
import {
  createFailedFoodSource,
  foodExists,
  getFoodSourceTranscripts,
  replaceCurrentFoodSource,
} from "@/lib/source-repository";

const MAX_MANUAL_TEXT_BYTES = 256 * 1024;

const KR_LABEL_REQUIRES_KOREAN =
  "국내 라벨로 등록하려면 원문에 한글 성분 표기가 있어야 합니다.";

/**
 * kr_label 은 한국에서 등록된 성분표라는 뜻이지 두 번째 출처 자리가 아니다.
 *
 * 예전에는 사료당 종류별 현행 출처가 하나뿐이라, 두 번째 제조사 페이지를 붙이려는
 * 호출자가 태그를 kr_label 로 뒤집어 빈 자리에 밀어 넣었다. 그렇게 등록된 영문
 * 페이지가 /foods/[id]에서 값마다 "국내라벨"로 표시됐다. 제약은 풀렸지만 태그를
 * 호출자 말만 믿을 이유는 없다 — 등록성분량은 한글로 쓰이므로 본문으로 확인한다.
 *
 * 호스트로 가르지 않는다: reflexkorea.com 은 .kr 도 /kr 경로도 아닌 진짜 한국
 * 수입사이고, royalcanin.com 은 같은 호스트 아래 /kr 과 /us 가 함께 있다.
 */
function statesKoreanLabel(kind: string, capturedText: string): boolean {
  return kind !== "kr_label" || /[가-힣]/.test(capturedText);
}

const sourcePayloadSchema = z.discriminatedUnion("captureMethod", [
  z
    .object({
      captureMethod: z.literal(SOURCE_CAPTURE_METHOD_VALUES[0]),
      kind: z.enum(SOURCE_KIND_VALUES),
      observedAt: z.string().datetime().nullable().optional(),
      url: z.string().url(),
    })
    .strict(),
  z
    .object({
      captureMethod: z.literal(SOURCE_CAPTURE_METHOD_VALUES[1]),
      capturedText: z.string().min(1),
      kind: z.enum(SOURCE_KIND_VALUES),
      observedAt: z.string().datetime().nullable().optional(),
      url: z.string().url(),
    })
    .strict(),
]);

export async function GET(
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

  const params = await context.params;
  const foodId = z.coerce.number().int().positive().safeParse(params.id);
  if (!foodId.success) {
    return NextResponse.json(
      { error: "사료 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const sources = await getFoodSourceTranscripts(foodId.data);
    return NextResponse.json({ sources });
  } catch {
    return NextResponse.json(
      { error: "출처 원문을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

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

  const params = await context.params;
  const foodId = z.coerce.number().int().positive().safeParse(params.id);
  if (!foodId.success) {
    return NextResponse.json(
      { error: "사료 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const payload = sourcePayloadSchema.safeParse(
      await readJsonBody(req, TRANSCRIPT_JSON_BODY_BYTES),
    );
    if (!payload.success) {
      return NextResponse.json(
        { error: "출처 등록 요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    if (!isPublicHttpUrl(payload.data.url)) {
      return NextResponse.json(
        { error: "HTTPS 공개 URL만 등록할 수 있습니다." },
        { status: 400 },
      );
    }
    // 수동 전사본은 "사람이 라벨을 읽고 옮겨 적었다"는 진술이다. 자동화 자격 증명이
    // 등록하면 그 진술이 거짓이 되고, 근거 검증도 자기가 써 넣은 글을 자기가 대조하는
    // 셈이 되어 hallucination 가드가 통째로 무의미해진다. 발행과 같은 이유로 사람
    // 세션만 허용한다.
    //
    // 'fetch'는 막지 않는다. 그쪽은 서버가 URL을 직접 수집한 원문에 대고 구절을
    // 검증하므로 제안자가 사람이든 스크립트든 경계가 성립한다 — 조사 스크립트가
    // 의존하는 경로이기도 하다.
    if (
      payload.data.captureMethod === "manual" &&
      (authorization.origin === "automation" || authorization.actorId === null)
    ) {
      return NextResponse.json(
        { error: "자동화 자격 증명으로는 수동 전사본을 등록할 수 없습니다." },
        { status: 403 },
      );
    }
    if (
      payload.data.captureMethod === "manual" &&
      Buffer.byteLength(payload.data.capturedText, "utf8") >
        MAX_MANUAL_TEXT_BYTES
    ) {
      return NextResponse.json(
        { error: "수동 전사본은 256 KiB 이하여야 합니다." },
        { status: 400 },
      );
    }
    if (!(await foodExists(foodId.data))) {
      return NextResponse.json(
        { error: "대상 사료를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (payload.data.captureMethod === "manual") {
      if (!statesKoreanLabel(payload.data.kind, payload.data.capturedText)) {
        return NextResponse.json(
          { error: KR_LABEL_REQUIRES_KOREAN },
          { status: 400 },
        );
      }
      const capturedAt = new Date().toISOString();
      const contentHash = hashSourceText(payload.data.capturedText);
      const replacement = await replaceCurrentFoodSource({
        capturedAt,
        capturedText: payload.data.capturedText,
        captureMethod: payload.data.captureMethod,
        contentHash,
        createdBy: authorization.actorId,
        failureCode: null,
        fetchStatus: "fetched",
        foodId: foodId.data,
        kind: payload.data.kind,
        observedAt: payload.data.observedAt ?? null,
        url: payload.data.url,
      });
      return NextResponse.json({
        contentStatus: replacement.contentStatus,
        source: {
          capturedAt,
          capturedText: payload.data.capturedText,
          contentHash,
          id: replacement.sourceId,
          kind: payload.data.kind,
          observedAt: payload.data.observedAt ?? null,
          url: payload.data.url,
        },
      });
    }

    const captured = await captureSource({
      kind: payload.data.kind,
      url: payload.data.url,
    });
    if (captured.kind === "failure") {
      const sourceId = await createFailedFoodSource({
        capturedAt: null,
        capturedText: null,
        captureMethod: payload.data.captureMethod,
        contentHash: null,
        createdBy: authorization.actorId,
        failureCode: captured.code,
        fetchStatus: "failed",
        foodId: foodId.data,
        kind: payload.data.kind,
        observedAt: payload.data.observedAt ?? null,
        url: payload.data.url,
      });
      return NextResponse.json(
        {
          error: "출처 페이지를 안전하게 수집하지 못했습니다.",
          sourceId,
        },
        { status: 422 },
      );
    }

    if (!statesKoreanLabel(payload.data.kind, captured.capturedText)) {
      return NextResponse.json(
        { error: KR_LABEL_REQUIRES_KOREAN },
        { status: 400 },
      );
    }

    const capturedAt = new Date().toISOString();
    const replacement = await replaceCurrentFoodSource({
      capturedAt,
      capturedText: captured.capturedText,
      captureMethod: payload.data.captureMethod,
      contentHash: captured.contentHash,
      createdBy: authorization.actorId,
      failureCode: null,
      fetchStatus: "fetched",
      foodId: foodId.data,
      kind: payload.data.kind,
      observedAt: payload.data.observedAt ?? null,
      url: captured.url,
    });
    return NextResponse.json({
      contentStatus: replacement.contentStatus,
      source: {
        capturedAt,
        capturedText: captured.capturedText,
        contentHash: captured.contentHash,
        id: replacement.sourceId,
        kind: payload.data.kind,
        observedAt: payload.data.observedAt ?? null,
        url: captured.url,
      },
    });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        {
          error: `요청 본문은 ${formatBodyLimit(TRANSCRIPT_JSON_BODY_BYTES)} 이하여야 합니다.`,
        },
        { status: 413 },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "요청 JSON 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "출처 등록에 실패했습니다." },
      { status: 500 },
    );
  }
}
