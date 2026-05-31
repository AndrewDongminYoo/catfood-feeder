import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as {
      cat_id?: number;
      food_id?: number;
      started_on?: string;
      ended_on?: string | null;
      note?: string | null;
    };

    if (!payload.cat_id || !payload.food_id || !payload.started_on) {
      return NextResponse.json(
        { error: "고양이, 제품, 시작일은 필수입니다." },
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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ feeding_log: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
