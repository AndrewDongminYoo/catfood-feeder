import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import {
  buildFeedingInsights,
  getFeedingDashboard,
  type CatProfile,
} from "./feeding";

describe("getFeedingDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns an explicit error when the authenticated cats query fails", async () => {
    const user = { id: "00000000-0000-0000-0000-000000000001" };
    const query = {
      order: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "database unavailable" },
      }),
      select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: vi.fn().mockReturnValue(query),
    });

    await expect(getFeedingDashboard()).resolves.toEqual({
      cats: [],
      configured: true,
      error: "급여 기록을 불러오지 못했습니다.",
      insights: [],
      user,
    });
  });

  it("attaches product and brand recall scope to authenticated feeding data", async () => {
    const user = { id: "00000000-0000-0000-0000-000000000001" };
    const sharedRecall = {
      affected_lots: "LOT-1",
      brand_id: 10,
      classification: "Class II",
      external_id: "recall-1",
      food_id: 20,
      id: 30,
      reason: "Example issue",
      recall_date: "2026-08-01",
      recalling_firm: "Example Firm",
      region: "US",
      source: "openFDA Food Enforcement",
      source_url: "https://example.test/recall",
    };
    const catsQuery = {
      order: vi.fn().mockResolvedValue({
        data: [
          {
            birth_date: null,
            feeding_logs: [
              {
                ended_on: null,
                foods: {
                  brand_id: 10,
                  brands: { id: 10, name: "Example Brand" },
                  carb_pct: 20,
                  energy_c_pct: 20,
                  energy_f_pct: 40,
                  energy_p_pct: 40,
                  fat_pct: 18,
                  id: 20,
                  kcal_per_kg: 3800,
                  product_name: "Example Food",
                  protein_pct: 36,
                  recalls: [sharedRecall],
                },
                id: 40,
                note: null,
                started_on: "2026-08-10",
              },
            ],
            id: 50,
            name: "Nabi",
          },
        ],
        error: null,
      }),
      select: vi.fn(),
    };
    catsQuery.select.mockReturnValue(catsQuery);
    const recallsQuery = {
      in: vi.fn(),
      is: vi.fn(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            ...sharedRecall,
            external_id: "recall-2",
            food_id: null,
            id: 31,
          },
        ],
        error: null,
      }),
      select: vi.fn(),
    };
    recallsQuery.select.mockReturnValue(recallsQuery);
    recallsQuery.is.mockReturnValue(recallsQuery);
    recallsQuery.in.mockReturnValue(recallsQuery);
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: vi.fn((table: string) =>
        table === "cats" ? catsQuery : recallsQuery,
      ),
    };
    mocks.createClient.mockResolvedValue(client);

    const dashboard = await getFeedingDashboard();

    expect(client.from).toHaveBeenCalledWith("recalls");
    expect(dashboard.cats[0]?.feeding_logs[0]?.foods?.recalls).toEqual([
      { ...sharedRecall, scope: "product" },
      {
        ...sharedRecall,
        external_id: "recall-2",
        food_id: null,
        id: 31,
        scope: "brand",
      },
    ]);
    expect(dashboard.error).toBeNull();
  });
});

describe("buildFeedingInsights", () => {
  it("distinguishes product and brand recall scope for the current food", () => {
    const sharedRecall = {
      affected_lots: "LOT-1",
      brand_id: 10,
      classification: "Class II",
      external_id: "recall-1",
      food_id: 20,
      id: 30,
      reason: "Example issue",
      recall_date: "2026-08-01",
      recalling_firm: "Example Firm",
      region: "US",
      source: "openFDA Food Enforcement",
      source_url: "https://example.test/recall",
    };
    const cats = [
      {
        birth_date: null,
        feeding_logs: [
          {
            ended_on: null,
            foods: {
              brand_id: 10,
              brands: { id: 10, name: "Example Brand" },
              carb_pct: 20,
              energy_c_pct: 20,
              energy_f_pct: 40,
              energy_p_pct: 40,
              fat_pct: 18,
              id: 20,
              kcal_per_kg: 3800,
              product_name: "Example Food",
              protein_pct: 36,
              recalls: [
                { ...sharedRecall, scope: "product" },
                {
                  ...sharedRecall,
                  external_id: "recall-2",
                  food_id: null,
                  id: 31,
                  scope: "brand",
                },
              ],
            },
            id: 40,
            note: null,
            started_on: "2026-08-10",
          },
        ],
        id: 50,
        name: "Nabi",
      },
    ] as CatProfile[];

    const insights = buildFeedingInsights(cats);

    expect(insights).toHaveLength(1);
    expect(insights[0].messages).toEqual([
      "현재 급여 중인 제품에 연결된 리콜 이력이 있습니다. 대상 로트를 원문에서 확인하세요.",
      "현재 급여 중인 제품의 브랜드 범위 리콜 이력이 있습니다. 이 제품·로트의 해당 여부는 확인되지 않았습니다.",
    ]);
  });
});
