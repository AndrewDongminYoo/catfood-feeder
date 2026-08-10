import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** 확인이 끝난 제안을 닫는다. 값은 이미 승인 경로가 저장했고, 여기서는 상태만 옮긴다. */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ runId: string }> },
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
      { error: "자동화 자격 증명으로는 전사 제안을 닫을 수 없습니다." },
      { status: 403 },
    );
  }

  const runId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await context.params).runId);
  const body = z
    .object({ status: z.enum(["applied", "rejected"]) })
    .safeParse(await req.json().catch(() => null));
  if (!runId.success || !body.success) {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("food_research_runs")
    .update({ status: body.data.status })
    .eq("id", runId.data)
    .eq("status", "pending_review");
  if (error) {
    return NextResponse.json(
      { error: "제안 상태를 바꾸지 못했습니다." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
