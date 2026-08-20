import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAdvisorCatalog,
  groupFoodEvidence,
  loadFoodEvidence,
  loadPublicFoodEvidence,
  type FoodNutrientEvidence,
} from "./catalog";
import { SAMPLE_ADVISOR_FOODS } from "./fixtures";

const { createPublicClientMock } = vi.hoisted(() => ({
  createPublicClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: createPublicClientMock,
}));

function clientReturning(data: unknown, error: unknown = null) {
  const eqSecond = vi.fn().mockResolvedValue({ data, error });
  const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
  const select = vi.fn().mockReturnValue({ eq: eqFirst });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select };
}

function bulkClientReturning(
  responseForIds: (foodIds: readonly number[]) => {
    data: unknown;
    error: unknown;
  },
) {
  const inIds = vi.fn(async (_column: string, foodIds: readonly number[]) =>
    responseForIds(foodIds),
  );
  const eq = vi.fn().mockReturnValue({ in: inIds });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, eq, from, inIds, select };
}

function bulkEvidenceRow(foodId: number): FoodNutrientEvidence {
  return {
    captured_at: "2026-08-18T00:00:00Z",
    excerpt: `Crude Protein ${foodId}%`,
    food_id: foodId,
    nutrient_key: "protein_pct",
    source: {
      capture_method: "fetch",
      url: `https://example.test/${foodId}`,
    },
    value: foodId,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  createPublicClientMock.mockReset();
});

describe("loadFoodEvidence", () => {
  it("requests only the granted columns of the embedded source", async () => {
    const { client, from, select } = clientReturning([]);
    await loadFoodEvidence(client, 95);
    expect(from).toHaveBeenCalledWith("food_nutrient_evidence");
    const requested = select.mock.calls[0]?.[0] as string;
    expect(requested).toContain("food_sources!inner(url, capture_method)");
    expect(requested).not.toContain("*");
    expect(requested).not.toContain("captured_text");
  });

  it("flattens the embedded source onto each evidence row", async () => {
    const { client } = clientReturning([
      {
        captured_at: "2026-08-18T00:00:00Z",
        excerpt: "Crude Protein 36.00%",
        food_sources: {
          capture_method: "fetch",
          url: "https://example.test/label",
        },
        nutrient_key: "protein_pct",
        value: 36,
      },
    ]);

    await expect(loadFoodEvidence(client, 95)).resolves.toEqual([
      {
        captured_at: "2026-08-18T00:00:00Z",
        excerpt: "Crude Protein 36.00%",
        nutrient_key: "protein_pct",
        source: {
          capture_method: "fetch",
          url: "https://example.test/label",
        },
        value: 36,
      },
    ]);
  });

  it("throws when the query errors so the caller can degrade deliberately", async () => {
    const { client } = clientReturning(null, { message: "permission denied" });
    await expect(loadFoodEvidence(client, 95)).rejects.toBeTruthy();
  });
});

describe("loadPublicFoodEvidence", () => {
  it("returns without querying for an empty food list", async () => {
    const { client, from } = bulkClientReturning(() => ({
      data: [],
      error: null,
    }));

    await expect(loadPublicFoodEvidence(client, [])).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("queries current public evidence in deterministic batches of 100", async () => {
    const { client, eq, inIds, select } = bulkClientReturning((foodIds) => ({
      data: foodIds.map((foodId) => ({
        ...bulkEvidenceRow(foodId),
        food_sources: bulkEvidenceRow(foodId).source,
        source: undefined,
      })),
      error: null,
    }));
    const foodIds = Array.from({ length: 205 }, (_, index) => index + 1);

    const evidence = await loadPublicFoodEvidence(client, foodIds);

    expect(inIds.mock.calls.map((call) => call[1])).toEqual([
      foodIds.slice(0, 100),
      foodIds.slice(100, 200),
      foodIds.slice(200),
    ]);
    expect(inIds).toHaveBeenCalledWith("food_id", expect.any(Array));
    expect(eq).toHaveBeenCalledTimes(3);
    expect(eq).toHaveBeenCalledWith("is_current", true);
    expect(select).toHaveBeenCalledTimes(3);
    expect(select.mock.calls[0]?.[0]).toBe(
      "food_id, nutrient_key, value, excerpt, captured_at, food_sources!inner(url, capture_method)",
    );
    expect(evidence).toHaveLength(205);
    expect(evidence[100]).toEqual(bulkEvidenceRow(101));
  });

  it("throws on any batch error", async () => {
    const { client } = bulkClientReturning(() => ({
      data: null,
      error: { message: "permission denied" },
    }));

    await expect(loadPublicFoodEvidence(client, [1])).rejects.toEqual({
      message: "permission denied",
    });
  });
});

describe("groupFoodEvidence", () => {
  it("preserves published foods that have no evidence rows", () => {
    const grouped = groupFoodEvidence([1, 2], [bulkEvidenceRow(2)]);

    expect(grouped.get(1)).toEqual([]);
    expect(grouped.get(2)).toEqual([
      {
        captured_at: "2026-08-18T00:00:00Z",
        excerpt: "Crude Protein 2%",
        nutrient_key: "protein_pct",
        source: {
          capture_method: "fetch",
          url: "https://example.test/2",
        },
        value: 2,
      },
    ]);
  });
});

describe("getAdvisorCatalog", () => {
  it("Supabase가 없으면 literal evidence를 포함한 공개 픽스처를 사용한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const result = await getAdvisorCatalog();

    expect(result.available).toBe(true);
    if (!result.available) throw new Error("fixture catalog expected");
    expect(result.foods).toEqual(SAMPLE_ADVISOR_FOODS);
    expect(SAMPLE_ADVISOR_FOODS[0]?.id).toBeGreaterThan(0);
    expect(result.evidenceByFoodId.get(SAMPLE_ADVISOR_FOODS[0]!.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          excerpt: expect.stringContaining("Crude protein (min.) 36 %"),
          nutrient_key: "protein_pct",
          value: 36,
        }),
        expect.objectContaining({
          excerpt: expect.stringContaining("3850 kcal/kg"),
          nutrient_key: "kcal_per_kg",
          value: 3850,
        }),
      ]),
    );
    expect(createPublicClientMock).not.toHaveBeenCalled();
  });

  it("returns a typed unavailable result when the public read fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key-value");
    createPublicClientMock.mockReturnValue({
      from: vi.fn(() => {
        throw new Error("public read failed");
      }),
    });
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(getAdvisorCatalog()).resolves.toEqual({
      available: false,
      reason: "load_failed",
    });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
