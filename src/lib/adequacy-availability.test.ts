import { it, expect, vi, beforeEach } from "vitest";
import { SAMPLE_FOODS } from "./fixtures";
import { getDecisionCatalog } from "./decision-catalog";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./catalog", () => ({
  getAdvisorCatalog: async () => ({
    available: true,
    foods: SAMPLE_FOODS,
    evidenceByFoodId: new Map([
      [
        SAMPLE_FOODS[0]!.id,
        [
          {
            nutrient_key: "kcal_per_kg",
            value: 4000,
            excerpt: "4000 kcal/kg",
            captured_at: "2026-10-01",
            source: {
              url: "https://example.test/label",
              capture_method: "fetch",
            },
          },
        ],
      ],
    ]),
  }),
  isSupabaseConfigured: () => true,
}));
vi.mock("./supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        not: () => query,
        eq: () => query,
        in: async () => ({
          data: [
            {
              food_id: SAMPLE_FOODS[0]!.id,
              excerpt: "Salmon, peas",
              captured_at: "2026-10-01",
              foods: { published_at: "2026-10-01" },
              food_sources: {
                food_id: SAMPLE_FOODS[0]!.id,
                url: "https://example.test/ingredients",
                is_current: true,
              },
            },
          ],
          error: null,
        }),
      };
      return query;
    },
  }),
}));
vi.mock("./adequacy-repository", () => ({ getAdequacyProofs: mocks.read }));
beforeEach(() => vi.clearAllMocks());
it("does not erase captured declarations under a successful refresh when retrieval fails", async () => {
  mocks.read.mockRejectedValue(new Error("connection failed"));
  expect((await getDecisionCatalog({ fresh: true })).available).toBe(false);
});
it("still accepts a successfully read empty evidence set", async () => {
  mocks.read.mockResolvedValue({});
  expect((await getDecisionCatalog({ fresh: true })).available).toBe(true);
});
it("retains a usable initial catalog while distinguishing failed declaration retrieval", async () => {
  mocks.read.mockRejectedValue(new Error("connection failed"));
  const result = await getDecisionCatalog();
  expect(result.available).toBe(true);
  expect(result.foods).toEqual(SAMPLE_FOODS);
  expect(result.evidence[0]?.[1]?.[0]?.excerpt).toBe("4000 kcal/kg");
  expect(result.ingredientEvidenceByFoodId).toEqual({
    [SAMPLE_FOODS[0]!.id]: {
      excerpt: "Salmon, peas",
      capturedAt: "2026-10-01",
      url: "https://example.test/ingredients",
    },
  });
  expect(result.adequacyUnavailable).toBe(true);
  expect(result.adequacyByFoodId).toEqual({});
});
it("distinguishes a successfully empty initial declaration read from failure", async () => {
  mocks.read.mockResolvedValue({});
  const result = await getDecisionCatalog();
  expect(result.available).toBe(true);
  expect(result.adequacyUnavailable).toBe(false);
});
