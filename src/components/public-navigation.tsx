import Link from "next/link";
import type { Route } from "next";

export function PublicNavigation() {
  return (
    <nav aria-label="주요 메뉴" className="public-navigation">
      <Link href="/foods">카탈로그</Link>
      <Link href={"/advisor" as Route}>다음 사료 찾기</Link>
      <Link href="/recalls">리콜 이력</Link>
      <Link href="/feeding">급여 내역</Link>
    </nav>
  );
}
