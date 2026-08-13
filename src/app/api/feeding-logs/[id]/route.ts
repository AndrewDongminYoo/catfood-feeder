import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/api-validation";
import {
  RequestBodyTooLargeError,
  SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "@/lib/request-body";
import { createClient } from "@/lib/supabase/server";

const feedingLogCorrectionSchema = z
  .object({
    food_id: z.number().int().positive().optional(),
    started_on: calendarDateSchema.optional(),
    ended_on: calendarDateSchema.nullable().optional(),
    note: z.string().max(2_000).nullable().optional(),
  })
  .strict()
  .refine((payload) => Object.keys(payload).length > 0)
  .refine(
    (payload) =>
      !payload.started_on ||
      !payload.ended_on ||
      payload.ended_on >= payload.started_on,
  );

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseFeedingLogId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isPeriodConflict(code: string | undefined) {
  return code === "22023" || code === "23505" || code === "23514";
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const feedingLogId = parseFeedingLogId((await params).id);
    if (feedingLogId === null) {
      return NextResponse.json(
        { error: "급여 기록 ID가 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const parsedPayload = feedingLogCorrectionSchema.safeParse(
      await readJsonBody(req, SMALL_JSON_BODY_BYTES),
    );
    if (!parsedPayload.success) {
      return NextResponse.json(
        { error: "수정할 급여 기록 값이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 },
      );
    }

    const { data, error } = await supabase
      .from("feeding_logs")
      .update(parsedPayload.data)
      .eq("id", feedingLogId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("feeding log update failed", error);
      if (isPeriodConflict(error.code)) {
        return NextResponse.json(
          { error: "급여 기간이 기존 기록과 충돌합니다." },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "급여 기록 수정에 실패했습니다." },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "급여 기록을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    return NextResponse.json({ feeding_log: data });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413 },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "요청 JSON 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    console.error("feeding log update failed", error);
    return NextResponse.json(
      { error: "급여 기록 수정에 실패했습니다." },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const feedingLogId = parseFeedingLogId((await params).id);
    if (feedingLogId === null) {
      return NextResponse.json(
        { error: "급여 기록 ID가 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 },
      );
    }

    const { data, error } = await supabase
      .from("feeding_logs")
      .delete()
      .eq("id", feedingLogId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("feeding log delete failed", error);
      return NextResponse.json(
        { error: "급여 기록 삭제에 실패했습니다." },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "급여 기록을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    return NextResponse.json({ feeding_log: data });
  } catch (error: unknown) {
    console.error("feeding log delete failed", error);
    return NextResponse.json(
      { error: "급여 기록 삭제에 실패했습니다." },
      { status: 500 },
    );
  }
}
