import { NextRequest, NextResponse } from "next/server";
import { authorizeCurator } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied") {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }
  if (authorization.origin === "automation") {
    return NextResponse.json(
      { error: "자동화 자격 증명으로는 Draft 목록을 조회할 수 없습니다." },
      { status: 403 },
    );
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("foods")
      .select(
        "id, product_name, protein_pct, data_verified_at, published_at, brands:brand_id(name), food_sources(id, kind, url, fetch_status, attempted_at, captured_at, observed_at, failure_code, is_current)",
      )
      .is("published_at", null)
      .order("id")
      .limit(1000);
    if (error) {
      return NextResponse.json(
        { error: "Draft 목록을 불러오지 못했습니다." },
        { status: 500 },
      );
    }
    return NextResponse.json({ foods: data ?? [] });
  } catch {
    return NextResponse.json(
      { error: "Draft 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
