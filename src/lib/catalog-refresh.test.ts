import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_FOODS } from "./fixtures";
const state = vi.hoisted(() => ({ foods: [] as unknown[] }));
vi.mock("next/cache", () => ({
  unstable_cache: (read: () => unknown) => {
    let value: unknown;
    return () => (value ??= read());
  },
}));
vi.mock("./supabase/public", () => ({
  createPublicClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        not: () => query,
        eq: () => query,
        is: () => query,
        in: () =>
          table === "recalls"
            ? query
            : Promise.resolve({ data: [], error: null }),
        order: () =>
          table === "recalls"
            ? Promise.resolve({ data: [], error: null })
            : query,
        range: async () => ({ data: state.foods, error: null }),
      };
      return query;
    },
  }),
}));
afterEach(() => vi.unstubAllEnvs());
describe("explicit catalog refresh", () => {
  it("bypasses cached food rows instead of re-dating the cached catalog", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "example-public-test-value",
    );
    const { getAdvisorCatalog } = await import("./catalog");
    state.foods = [{ ...SAMPLE_FOODS[0]!, product_name: "Old recipe" }];
    const first = await getAdvisorCatalog();
    expect(first.available && first.foods[0]?.product_name).toBe("Old recipe");
    state.foods = [{ ...SAMPLE_FOODS[0]!, product_name: "Changed recipe" }];
    const cached = await getAdvisorCatalog();
    expect(cached.available && cached.foods[0]?.product_name).toBe(
      "Old recipe",
    );
    const fresh = await getAdvisorCatalog({ fresh: true });
    expect(fresh.available && fresh.foods[0]?.product_name).toBe(
      "Changed recipe",
    );
  });
});
