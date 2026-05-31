import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { name, birth_date } = (await req.json()) as {
      name?: string;
      birth_date?: string | null;
    };
    const catName = name?.trim();
    if (!catName) {
      return NextResponse.json(
        { error: "고양이 이름은 필수입니다." },
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
      .from("cats")
      .insert({
        owner_id: user.id,
        name: catName,
        birth_date: birth_date || null,
      })
      .select("id, name, birth_date")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ cat: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
