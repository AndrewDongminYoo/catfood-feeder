"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({
  next,
  initialError,
}: {
  next?: string;
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      if (next) callbackUrl.searchParams.set("next", next);
      const { error: signInError } = await createClient().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callbackUrl.toString() },
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      setMessage("로그인 링크를 이메일로 보냈습니다.");
    } catch {
      setError("로그인 링크를 보내지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-panel">
      <label>
        이메일
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <button
        className="primary"
        onClick={signIn}
        disabled={loading || !email.includes("@")}
      >
        {loading ? "전송 중..." : "로그인 링크 받기"}
      </button>
      {message && <div className="okbox">{message}</div>}
      {error && <div className="err">{error}</div>}
    </div>
  );
}
