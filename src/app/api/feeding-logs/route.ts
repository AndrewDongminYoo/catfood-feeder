import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/api-validation";
import {
  RequestBodyTooLargeError,
  SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "@/lib/request-body";
import { createClient } from "@/lib/supabase/server";

const feedingLogSchema = z.object({
  cat_id: z.number().int().positive(),
  food_id: z.number().int().positive(),
  started_on: calendarDateSchema,
  ended_on: calendarDateSchema.nullable().optional(),
  note: z.string().max(2_000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const parsedPayload = feedingLogSchema.safeParse(
      await readJsonBody(req, SMALL_JSON_BODY_BYTES),
    );
    if (!parsedPayload.success) {
      return NextResponse.json(
        { error: "고양이, 제품, 시작일은 필수입니다." },
        { status: 400 },
      );
    }
    const payload = parsedPayload.data;
    if (payload.ended_on && payload.ended_on < payload.started_on) {
      return NextResponse.json(
        { error: "종료일은 시작일보다 빠를 수 없습니다." },
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
      .insert({
        cat_id: payload.cat_id,
        food_id: payload.food_id,
        started_on: payload.started_on,
        ended_on: payload.ended_on || null,
        note: payload.note || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("feeding log insert failed", error);
      return NextResponse.json(
        { error: "급여 기록 저장에 실패했습니다." },
        { status: 500 },
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
    console.error("feeding log insert failed", error);
    return NextResponse.json(
      { error: "급여 기록 저장에 실패했습니다." },
      { status: 500 },
    );
  }
}
