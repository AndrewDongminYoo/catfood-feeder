import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { POST } from "./route";

function createSupabaseClient({
  insertResult = { data: { id: 42 }, error: null },
  rpcResult = { data: 42, error: null },
  user = { id: "00000000-0000-0000-0000-000000000001" },
}: {
  insertResult?: { data: { id: number } | null; error: unknown };
  rpcResult?: { data: number | null; error: unknown };
  user?: { id: string } | null;
} = {}) {
  const query = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn().mockResolvedValue(insertResult),
  };
  query.insert.mockReturnValue(query);
  query.select.mockReturnValue(query);

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockReturnValue(query),
    query,
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
}

function post(body: unknown) {
  return POST(
    new NextRequest("https://app.test/api/feeding-logs", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

describe("POST /api/feeding-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an invalid feeding period", async () => {
    const response = await post({ cat_id: 1, food_id: 2 });

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    const client = createSupabaseClient({ user: null });
    mocks.createClient.mockResolvedValue(client);

    const response = await post({
      cat_id: 1,
      food_id: 2,
      started_on: "2026-08-13",
    });

    expect(response.status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("routes a current period through the atomic switch RPC", async () => {
    const client = createSupabaseClient();
    mocks.createClient.mockResolvedValue(client);

    const response = await post({
      cat_id: 1,
      ended_on: null,
      food_id: 2,
      note: "새 사료",
      started_on: "2026-08-13",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      feeding_log: { id: 42 },
    });
    expect(client.rpc).toHaveBeenCalledWith("switch_current_feeding", {
      p_cat_id: 1,
      p_food_id: 2,
      p_note: "새 사료",
      p_started_on: "2026-08-13",
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("retains direct inserts for a closed historical period", async () => {
    const client = createSupabaseClient();
    mocks.createClient.mockResolvedValue(client);

    const response = await post({
      cat_id: 1,
      ended_on: "2026-08-12",
      food_id: 2,
      note: null,
      started_on: "2026-08-01",
    });

    expect(response.status).toBe(200);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.query.insert).toHaveBeenCalledWith({
      cat_id: 1,
      ended_on: "2026-08-12",
      food_id: 2,
      note: null,
      started_on: "2026-08-01",
    });
  });

  it("maps a switch date conflict to 409", async () => {
    const client = createSupabaseClient({
      rpcResult: {
        data: null,
        error: { code: "22023", message: "backdated switch" },
      },
    });
    mocks.createClient.mockResolvedValue(client);

    const response = await post({
      cat_id: 1,
      food_id: 2,
      started_on: "2026-08-01",
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("충돌");
  });

  it("maps an unexpected database error to 500", async () => {
    const client = createSupabaseClient({
      rpcResult: {
        data: null,
        error: { code: "XX000", message: "database failure" },
      },
    });
    mocks.createClient.mockResolvedValue(client);

    const response = await post({
      cat_id: 1,
      food_id: 2,
      started_on: "2026-08-13",
    });

    expect(response.status).toBe(500);
  });
});
