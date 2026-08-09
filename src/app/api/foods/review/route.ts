import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import { loadPublicationReview } from "@/lib/publication-review";

/**
 * 브랜드를 바꿀 때 검토 목록을 다시 가져오는 경로. 첫 렌더는 서버 컴포넌트가 같은
 * 함수로 직접 채우므로, 두 순간이 서로 다른 계산을 하지 않는다.
 */
export async function GET(req: NextRequest) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied") {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }

  const brandId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(req.nextUrl.searchParams.get("brandId"));

  try {
    return NextResponse.json(
      await loadPublicationReview(brandId.success ? brandId.data : null),
    );
  } catch (error: unknown) {
    console.error("review listing failed", error);
    return NextResponse.json(
      { error: "검토 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
