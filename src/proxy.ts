import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  // 세션 쿠키 갱신(랜덤 로그아웃 방지) + 보호 경로(/new) 게이팅.
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 정적 자산을 제외한 모든 요청 경로에 매칭.
     * - _next/static, _next/image: 빌드 산출물
     * - favicon.ico, 이미지 확장자: 정적 파일
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
