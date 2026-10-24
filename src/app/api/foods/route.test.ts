import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  authorizeCurator: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/admin-auth", () => ({
  authorizeCurator: mocks.authorizeCurator,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

const basePayload = {
  brand: "Fixture Brand",
  product_name: "Fixture Food",
  cooking_method: "extrusion",
  protein_pct: 36,
  fat_pct: 18,
  fiber_pct: 4,
  ash_pct: 9,
  moisture_pct: 10,
  nutrient_sources: {
    protein_pct: "manufacturer",
    fat_pct: "manufacturer",
    fiber_pct: "manufacturer",
    ash_pct: "kr_label",
    moisture_pct: "manufacturer",
  },
};

function createClient() {
  const brands = {
    select: vi.fn(),
    ilike: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 10 }, error: null }),
  };
  brands.select.mockReturnValue(brands);
  brands.ilike.mockReturnValue(brands);
  brands.is.mockReturnValue(brands);
  const foods = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: { id: 321 }, error: null }),
  };
  foods.insert.mockReturnValue(foods);
  foods.select.mockReturnValue(foods);
  return {
    foods,
    client: {
      from: vi.fn((table: string) => {
        if (table === "brands") return brands;
        if (table === "foods") return foods;
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

const cases = [
  {
    name: "null input",
    input: { carb_pct: null },
    carb: 23,
    estimated: false,
    source: "derived",
  },
  {
    name: "missing input",
    input: { carb_pct: undefined },
    carb: 23,
    estimated: false,
    source: "derived",
  },
  {
    name: "estimated ash",
    input: { carb_pct: null, ash_pct: null },
    carb: 23,
    estimated: true,
    source: "estimated",
  },
  {
    name: "non-computable input",
    input: { carb_pct: null, ash_pct: null, cooking_method: "baked" },
    carb: null,
    estimated: false,
    source: undefined,
  },
  {
    name: "stated NFE without moisture",
    input: { carb_pct: 30.5, moisture_pct: null },
    carb: 30.5,
    estimated: false,
    source: "measured",
  },
  {
    name: "stated zero",
    input: { carb_pct: 0 },
    carb: 0,
    estimated: false,
    source: "measured",
  },
];

describe.each(["human", "automation"] as const)(
  "POST /api/foods carb provenance for %s",
  (origin) => {
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.authorizeCurator.mockResolvedValue({
        kind: "authorized",
        origin,
        actorId:
          origin === "human" ? "00000000-0000-0000-0000-000000000001" : null,
        rateLimitKey: origin,
      });
    });

    describe.each(["manufacturer", "kr_label"])("supplied %s tag", (source) => {
      it.each(cases)("stores honest provenance for $name", async (testCase) => {
        const { foods, client } = createClient();
        mocks.createAdminClient.mockReturnValue(client);
        const response = await POST(
          new NextRequest("http://localhost/api/foods", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...basePayload,
              ...testCase.input,
              nutrient_sources: {
                ...basePayload.nutrient_sources,
                carb_pct: source,
              },
            }),
          }),
        );
        expect(response.status).toBe(200);
        expect(foods.insert).toHaveBeenCalledOnce();
        const inserted = foods.insert.mock.calls[0][0];
        expect(inserted.carb_pct).toBe(testCase.carb);
        expect(inserted.carb_is_estimated).toBe(testCase.estimated);
        if (testCase.source === undefined) {
          expect(inserted.nutrient_sources).not.toHaveProperty("carb_pct");
        } else {
          expect(inserted.nutrient_sources.carb_pct).toBe(
            testCase.source === "measured" ? source : testCase.source,
          );
        }
        expect(inserted.published_at).toEqual(
          origin === "human" ? expect.any(String) : null,
        );
        expect(inserted.verification_method).toBe(
          origin === "human" ? "human" : null,
        );
      });
    });
  },
);
