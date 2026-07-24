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
  if (authorization.origin === "automation") {
    return NextResponse.json(
      { error: "자동화 자격 증명으로는 출처를 조회할 수 없습니다." },
      { status: 403 },
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
  if (authorization.origin === "automation") {
    return NextResponse.json(
      { error: "자동화 자격 증명으로는 출처를 등록할 수 없습니다." },
      { status: 403 },
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
