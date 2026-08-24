import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import {
  RequestBodyTooLargeError,
  SMALL_JSON_BODY_BYTES,
  readJsonBody,
} from "@/lib/request-body";
import { ingredientDraftSchema, isIngredientRefusal } from "@/lib/source-apply";
import {
  applyFoodIngredientsDraft,
  foodExists,
  getCurrentFetchedFoodSources,
} from "@/lib/source-repository";

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
    const parsed = ingredientDraftSchema.safeParse(
      await readJsonBody(req, SMALL_JSON_BODY_BYTES),
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: "원재료 적용 요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    if (!(await foodExists(foodId.data)))
      return NextResponse.json(
        { error: "대상 사료를 찾을 수 없습니다." },
        { status: 404 },
      );
    const sources = await getCurrentFetchedFoodSources(foodId.data, [
      parsed.data.sourceId,
    ]);
    if (sources.length === 0)
      return NextResponse.json(
        { error: "출처가 현재 수집본과 일치하지 않습니다." },
        { status: 400 },
      );
    // 대상은 이미 사람이 검증한 발행 행이고 그 검증 시각은 영양소로 얻은 것이다.
    // 원재료를 누가 넣었는지 근거 행에 남겨야 사람 검증 도장이 검증한 적 없는
    // 데이터까지 덮는 것처럼 읽히지 않는다.
    const result = await applyFoodIngredientsDraft(
      foodId.data,
      parsed.data,
      authorization.origin,
    );
    return NextResponse.json({ result });
  } catch (error: unknown) {
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
    console.error("applyFoodIngredientsDraft failed", error);
    // 영양소 경로와 같은 이유로 거절과 장애를 가른다. RPC 가 근거를 거절한 것은
    // 요청이 틀린 것이지 서버가 고장난 것이 아니고, 500 으로 뭉뚱그리면 배치
    // 집계에서 "거절"이 "실패"로 둔갑한다. 다만 그쪽처럼 문구로 가르지 않는다 —
    // 이 RPC 는 계약을 이쪽이 소유하므로 SQLSTATE 하나로 판정한다.
    if (isIngredientRefusal(error)) {
      return NextResponse.json(
        { error: "근거가 검증을 통과하지 못했습니다." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "원재료 적용에 실패했습니다." },
      { status: 500 },
    );
  }
}
