import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const initialError =
    error === "missing_code" || error === "exchange_failed"
      ? "로그인 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해 주세요."
      : undefined;

  return (
    <main className="wrap">
      <header className="hd">
        <p>
          <Link href="/">← 홈</Link>
        </p>
        <h1>로그인</h1>
        <p>급여 기록과 반려묘 프로필은 로그인 후 사용할 수 있습니다.</p>
      </header>
      <section className="card">
        <AuthForm next={next} initialError={initialError} />
      </section>
    </main>
  );
}
