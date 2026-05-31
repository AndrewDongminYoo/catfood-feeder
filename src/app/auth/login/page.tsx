import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
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
        <AuthForm />
      </section>
    </main>
  );
}
