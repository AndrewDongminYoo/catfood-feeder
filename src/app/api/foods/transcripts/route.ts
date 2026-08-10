import { NextRequest, NextResponse } from "next/server";
import { authorizeCurator } from "@/lib/admin-auth";
import { loadPendingTranscripts } from "@/lib/label-transcripts";

/** 승인·건너뜀 뒤에 목록을 다시 가져오는 경로. 첫 렌더는 서버 컴포넌트가 같은 함수를 쓴다. */
export async function GET(req: NextRequest) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied") {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }
  try {
    return NextResponse.json({ transcripts: await loadPendingTranscripts() });
  } catch (error: unknown) {
    console.error("transcript listing failed", error);
    return NextResponse.json(
      { error: "전사 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
