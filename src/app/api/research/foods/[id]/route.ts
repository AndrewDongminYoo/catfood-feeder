import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeResearchAgent } from "@/lib/research-auth";
import { getResearchTarget } from "@/lib/research-repository";

/**
 * 러너가 필요한 최소 맥락만 준다: 대상 ID, 브랜드, 제품명.
 * 원장·전사본·다른 사료 목록은 이 경계를 통해 나가지 않는다.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = authorizeResearchAgent(req);
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
    const target = await getResearchTarget(foodId.data);
    if (target.kind === "not_found")
      return NextResponse.json(
        { error: "대상 사료를 찾을 수 없습니다." },
        { status: 404 },
      );
    if (target.kind === "not_skeleton")
      return NextResponse.json(
        {
          error:
            "이미 발행됐거나 출처가 등록된 사료는 자동 조사 대상이 아닙니다.",
        },
        { status: 409 },
      );

    return NextResponse.json({
      target: {
        brandName: target.brandName,
        id: target.id,
        productName: target.productName,
      },
    });
  } catch (error: unknown) {
    console.error("research target lookup failed", error);
    return NextResponse.json(
      { error: "조사 대상을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
