"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AuthForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const origin = window.location.origin;
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    setMessage("로그인 링크를 이메일로 보냈습니다.");
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
