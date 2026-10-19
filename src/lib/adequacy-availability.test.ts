import { it, expect, vi, beforeEach } from "vitest";
import { SAMPLE_FOODS } from "./fixtures";
import { getDecisionCatalog } from "./decision-catalog";
import { GET } from "@/app/api/advisor/catalog/route";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  ingredientRead: vi.fn(),
  emptyIngredients: false,
}));
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
          data: mocks.emptyIngredients
            ? []
            : [
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
          error: await mocks.ingredientRead(),
        }),
      };
      return query;
    },
  }),
}));
vi.mock("./adequacy-repository", () => ({ getAdequacyProofs: mocks.read }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.emptyIngredients = false;
  mocks.ingredientRead.mockResolvedValue(null);
});
it("marks initial ingredient retrieval failures without discarding calorie evidence", async () => {
  mocks.read.mockResolvedValue({});
  mocks.ingredientRead.mockRejectedValue(new Error("ingredient read failed"));
  const result = await getDecisionCatalog();
  expect(result.available).toBe(true);
  expect(result.foods).toEqual(SAMPLE_FOODS);
  expect(result.evidence[0]?.[1]?.[0]?.excerpt).toBe("4000 kcal/kg");
  expect(result.ingredientEvidenceUnavailable).toBe(true);
  expect(result.ingredientEvidenceByFoodId).toEqual({});
});
it("refuses failed fresh ingredient retrieval through the public route", async () => {
  mocks.read.mockResolvedValue({});
  mocks.ingredientRead.mockResolvedValue(new Error("ingredient read failed"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect((await response.json()).available).toBe(false);
});
it("distinguishes a successful ingredient read from an unavailable read", async () => {
  mocks.read.mockResolvedValue({});
  const result = await getDecisionCatalog({ fresh: true });
  expect(result.available).toBe(true);
  expect(result.ingredientEvidenceUnavailable).toBe(false);
});
it("accepts a successfully empty ingredient read on explicit refresh", async () => {
  mocks.read.mockResolvedValue({});
  mocks.emptyIngredients = true;
  const response = await GET();
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.ingredientEvidenceUnavailable).toBe(false);
  expect(result.ingredientEvidenceByFoodId).toEqual({});
});
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
