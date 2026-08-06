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

const readyRow = {
  ash_pct: 9,
  calcium_pct: 1.6,
  cooking_method: "extrusion",
  fat_pct: 18,
  fiber_pct: 4,
  kcal_per_kg: 3850,
  moisture_pct: 10,
  nutrient_sources: {
    ash_pct: "kr_label",
    calcium_pct: "manufacturer",
    fat_pct: "manufacturer",
    fiber_pct: "manufacturer",
    kcal_per_kg: "manufacturer",
    moisture_pct: "manufacturer",
    phosphorus_pct: "manufacturer",
    protein_pct: "manufacturer",
  },
  phosphorus_pct: 1.2,
  protein_pct: 36,
  published_at: null,
  updated_at: "2026-08-05T10:00:00.000Z",
};

function createFoodQuery(
  data: unknown,
  error: { message: string } | null = null,
) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

function createClient(
  row: unknown = readyRow,
  rpcResult: unknown = {
    published_at: "2026-08-05T10:01:00+00:00",
    status: "published",
  },
) {
  const query = createFoodQuery(row);
  return {
    client: {
      from: vi.fn().mockReturnValue(query),
      rpc: vi.fn().mockResolvedValue({ data: rpcResult, error: null }),
    },
    query,
  };
}

function callRoute(id = "1") {
  return POST(
    new NextRequest(`http://localhost/api/foods/${id}/publish`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("POST /api/foods/[id]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeCurator.mockResolvedValue({
      actorId: "00000000-0000-0000-0000-000000000001",
      kind: "authorized",
      origin: "human",
      rateLimitKey: "00000000-0000-0000-0000-000000000001",
    });
  });

  it("publishes a valid stored draft without accepting nutrient input", async () => {
    const { client } = createClient();
    mocks.createAdminClient.mockReturnValue(client);

    const response = await callRoute();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      food: {
        id: 1,
        publishedAt: "2026-08-05T10:01:00+00:00",
        verificationMethod: "human",
      },
    });
    expect(client.rpc).toHaveBeenCalledWith("publish_food_draft", {
      p_actor_id: "00000000-0000-0000-0000-000000000001",
      p_derived: expect.objectContaining({
        carbIsEstimated: false,
        carbPct: 23,
      }),
      p_expected_updated_at: "2026-08-05T10:00:00.000Z",
      p_food_id: 1,
    });
  });

  it("rejects automation credentials before loading a draft", async () => {
    mocks.authorizeCurator.mockResolvedValue({
      actorId: null,
      kind: "authorized",
      origin: "automation",
      rateLimitKey: "automation",
    });

    const response = await callRoute();

    expect(response.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed food id", async () => {
    const response = await callRoute("not-an-id");

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 404 when the food does not exist", async () => {
    const { client } = createClient(null);
    mocks.createAdminClient.mockReturnValue(client);

    const response = await callRoute();

    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns 409 before preparation when the row is already published", async () => {
    const { client } = createClient({
      ...readyRow,
      published_at: "2026-08-05T09:00:00.000Z",
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await callRoute();

    expect(response.status).toBe(409);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns the blocking stored-data error without calling the RPC", async () => {
    const { client } = createClient({
      ...readyRow,
      fat_pct: 70,
      moisture_pct: null,
      protein_pct: 50,
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await callRoute();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "보장성분 합계 133% — 100% 초과(입력 오류 가능)",
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["stale", 409, "다시 불러온 뒤"],
    ["no_evidence", 400, "보존된 성분 근거"],
    ["not_found", 404, "찾을 수 없습니다"],
    ["already_published", 409, "이미 발행"],
  ])("maps %s to HTTP %i", async (status, expectedStatus, message) => {
    const { client } = createClient(readyRow, { status });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await callRoute();

    expect(response.status).toBe(expectedStatus);
    expect((await response.json()).error).toContain(message);
  });

  it.each([
    ["missing_evidence", "fat_pct", "근거가 없습니다"],
    ["evidence_mismatch", "protein_pct", "일치하지 않습니다"],
  ])("maps %s with its nutrient key", async (status, nutrientKey, message) => {
    const { client } = createClient(readyRow, {
      nutrient_key: nutrientKey,
      status,
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await callRoute();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain(nutrientKey);
    expect(body.error).toContain(message);
  });

  it("returns 500 for malformed RPC JSON", async () => {
    const { client } = createClient(readyRow, { status: "unknown" });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await callRoute();

    expect(response.status).toBe(500);
  });

  it("returns 500 for an unexpected RPC error", async () => {
    const { client } = createClient();
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await callRoute();

    expect(response.status).toBe(500);
  });
});
