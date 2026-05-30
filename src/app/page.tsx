import Link from "next/link";

export default function Home() {
  return (
    <main className="wrap">
      <header className="hd">
        <h1>수입 건사료 큐레이션</h1>
        <p>관리자 도구</p>
      </header>
      <section className="card">
        <Link
          href="/new"
          className="primary"
          style={{
            display: "block",
            textAlign: "center",
            textDecoration: "none",
            lineHeight: "1.4",
          }}
        >
          + 새 사료 성분 입력
        </Link>
      </section>
    </main>
  );
}
