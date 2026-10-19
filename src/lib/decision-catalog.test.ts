import { describe, expect, it } from "vitest";
import { loadDecisionIngredientProofs } from "./decision-catalog";

describe("decision ingredient projection", () => {
  it("returns only current same-food sources for the supplied published food IDs", async () => {
    const query = {
      select: () => query,
      not: () => query,
      eq: () => query,
      in: async (_: string, ids: number[]) => ({
        data: [
          {
            food_id: ids[0],
            excerpt: "salmon, peas",
            foods: { published_at: "2026-10-01" },
            captured_at: "2026-10-01",
            food_sources: {
              food_id: ids[0],
              url: "https://example.test/recipe",
              is_current: true,
            },
          },
          {
            food_id: 999,
            excerpt: "private draft",
            captured_at: "2026-10-01",
            food_sources: {
              food_id: 999,
              url: "https://example.test/private",
              is_current: true,
            },
          },
          {
            food_id: ids[0],
            excerpt: "wrong food",
            captured_at: "2026-10-01",
            food_sources: {
              food_id: 2,
              url: "https://example.test/wrong",
              is_current: true,
            },
          },
          {
            food_id: ids[0],
            excerpt: "retired",
            captured_at: "2026-10-01",
            food_sources: {
              food_id: ids[0],
              url: "https://example.test/old",
              is_current: false,
            },
          },
          {
            food_id: ids[0],
            excerpt: "unpublished after the public cache was filled",
            captured_at: "2026-10-01",
            foods: { published_at: null },
            food_sources: {
              food_id: ids[0],
              url: "https://example.test/private-now",
              is_current: true,
            },
          },
        ],
        error: null,
      }),
    };
    const result = await loadDecisionIngredientProofs(
      { from: () => query } as never,
      [1],
    );
    expect(Object.keys(result)).toEqual(["1"]);
    expect(result[1]?.excerpt).toBe("salmon, peas");
  });
  it("does not query privileged tables for an empty public catalog", async () => {
    expect(
      await loadDecisionIngredientProofs(
        {
          from: () => {
            throw new Error("must not query");
          },
        } as never,
        [],
      ),
    ).toEqual({});
  });
});
