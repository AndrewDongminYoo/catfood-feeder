import { describe, expect, it, vi } from "vitest";

const { cacheRegistrations } = vi.hoisted(() => ({
  cacheRegistrations: [] as Array<{
    keyParts: string[];
    options: { revalidate?: number; tags?: string[] };
  }>,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (
    callback: () => unknown,
    keyParts: string[],
    options: { revalidate?: number; tags?: string[] },
  ) => {
    cacheRegistrations.push({ keyParts, options });
    return callback;
  },
}));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => {
    throw new Error("Public catalog must not create a cookie-aware client.");
  }),
}));

describe("public catalog cache", () => {
  it("제품, advisor 근거, 리콜 공개 읽기를 각각 한 시간 캐시에 등록한다", async () => {
    await import("./catalog");

    expect(cacheRegistrations).toEqual([
      {
        keyParts: ["public-foods"],
        options: { revalidate: 3600, tags: ["public-foods"] },
      },
      {
        keyParts: ["public-advisor-catalog"],
        options: { revalidate: 3600, tags: ["public-foods"] },
      },
      {
        keyParts: ["public-recalls"],
        options: { revalidate: 3600, tags: ["public-recalls"] },
      },
    ]);
  });
});
