import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import { adequacyApplySchema } from "@/lib/adequacy-evidence";
import { AdequacyRefusal, applyAdequacy } from "@/lib/adequacy-repository";
import {
  readJsonBody,
  SMALL_JSON_BODY_BYTES,
  RequestBodyTooLargeError,
} from "@/lib/request-body";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied")
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  const foodId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await context.params).id);
  if (!foodId.success)
    return NextResponse.json(
      { error: "사료 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  try {
    const draft = adequacyApplySchema.safeParse(
      await readJsonBody(req, SMALL_JSON_BODY_BYTES),
    );
    if (!draft.success)
      return NextResponse.json(
        { error: "선언 적용 요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    const result = await applyAdequacy(
      foodId.data,
      draft.data,
      authorization.origin,
    );
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return NextResponse.json(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "요청 JSON 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    if (error instanceof AdequacyRefusal)
      return NextResponse.json(
        { error: "선언이 현재 제조사 원문과 일치하지 않습니다." },
        { status: 400 },
      );
    console.error(
      "Adequacy apply failed",
      error instanceof Error ? error.message : "query failed",
    );
    return NextResponse.json(
      { error: "선언 적용에 실패했습니다." },
      { status: 500 },
    );
  }
}
