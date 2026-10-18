import type { Metadata, Viewport } from "next";
import { PublicNavigation } from "@/components/public-navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "다음 한 봉지 · 고양이 사료 선택",
  description:
    "지금 먹는 사료와 바꾸고 싶은 이유로 다음 사료를 검토합니다. 조건에 맞는 후보, 달라지는 점, 출처와 확인할 질문을 함께 살펴보세요.",
};

// maximumScale은 지정하지 않는다. 모바일 우선 앱에서 핀치 줌을 막으면 성분표를
// 확대할 수 없어 WCAG 1.4.4에 위배된다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <PublicNavigation />
        {children}
      </body>
    </html>
  );
}
