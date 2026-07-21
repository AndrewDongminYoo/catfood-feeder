import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calendarDateSchema } from "@/lib/api-validation";
import {
  RequestBodyTooLargeError,
  SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "@/lib/request-body";
import { createClient } from "@/lib/supabase/server";

const catSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    birth_date: calendarDateSchema.nullable().optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const parsedPayload = catSchema.safeParse(
      await readJsonBody(req, SMALL_JSON_BODY_BYTES),
    );
    if (!parsedPayload.success) {
      return NextResponse.json(
        { error: "고양이 이름은 필수이며 60자 이하여야 합니다." },
        { status: 400 },
      );
    }
    const payload = parsedPayload.data;

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
      .from("cats")
      .insert({
        owner_id: user.id,
        name: payload.name,
        birth_date: payload.birth_date ?? null,
      })
      .select("id, name, birth_date")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "고양이 등록에 실패했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({ cat: data });
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
    return NextResponse.json(
      { error: "고양이 등록에 실패했습니다." },
      { status: 500 },
    );
  }
}
