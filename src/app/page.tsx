import Link from "next/link";
import type { Route } from "next";

export default function Home() {
  return (
    <main className="wide">
      <header className="hd">
        <h1>수입 건사료 큐레이션</h1>
        <p>성분 큐레이션, 공개 카탈로그, 리콜 이력, 급여 기록</p>
      </header>

      <section className="home-grid">
        <HomeLink
          href="/new"
          title="성분 입력"
          text="제조사 원문과 국내 라벨을 구조화합니다."
        />
        <HomeLink
          href="/foods"
          title="카탈로그"
          text="성분 기준으로 사료를 찾고 비교합니다."
        />
        <HomeLink
          href="/recalls"
          title="리콜 이력"
          text="openFDA 기반 리콜 이력을 확인합니다."
        />
        <HomeLink
          href="/feeding"
          title="급여 기록"
          text="제품 교체와 열량 급변을 추적합니다."
        />
      </section>
    </main>
  );
}

function HomeLink({
  href,
  title,
  text,
}: {
  href: string;
  title: string;
  text: string;
}) {
  return (
    <Link href={href as Route} className="home-link">
      <strong>{title}</strong>
      <span>{text}</span>
    </Link>
  );
}
