import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "사료 성분 입력 도구",
  description: "수입 건사료 성분 큐레이션 — 관리자 입력 도구",
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
