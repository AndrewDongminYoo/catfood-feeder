import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseClient } = vi.hoisted(() => ({
  createSupabaseClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createSupabaseClient,
}));

import { createPublicClient } from "./public";

describe("createPublicClient", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    createSupabaseClient.mockReset();
  });

  it("쿠키나 세션 저장 없이 공개 데이터용 클라이언트를 만든다", () => {
    createPublicClient();

    expect(createSupabaseClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "public-test-key",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
  });

  it("공개 환경 변수가 없으면 명시적으로 실패한다", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    expect(() => createPublicClient()).toThrow(
      "Supabase public client is not configured.",
    );
  });
});
