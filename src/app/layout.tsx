import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "고양이 사료 카탈로그",
  description:
    "수입 건사료의 성분, 원재료, 출처 상태를 읽고 두 제품을 비교합니다.",
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
      <body>{children}</body>
    </html>
  );
}
