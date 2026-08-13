import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { DELETE, PATCH } from "./route";

function createSupabaseClient({
  result = { data: { id: 7 }, error: null },
  user = { id: "00000000-0000-0000-0000-000000000001" },
}: {
  result?: { data: { id: number } | null; error: unknown };
  user?: { id: string } | null;
} = {}) {
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(),
    update: vi.fn(),
  };
  query.delete.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.update.mockReturnValue(query);

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockReturnValue(query),
    query,
  };
}

function patch(body: unknown, id = "7") {
  return PATCH(
    new NextRequest(`https://app.test/api/feeding-logs/${id}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }),
    { params: Promise.resolve({ id }) },
  );
}

function remove(id = "7") {
  return DELETE(
    new NextRequest(`https://app.test/api/feeding-logs/${id}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("/api/feeding-logs/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication before a correction", async () => {
    const client = createSupabaseClient({ user: null });
    mocks.createClient.mockResolvedValue(client);

    const response = await patch({ note: "수정" });

    expect(response.status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects a malformed feeding log id", async () => {
    const response = await patch({ note: "수정" }, "not-an-id");

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([{}, { unknown: true }, { food_id: -1 }])(
    "rejects an empty or invalid PATCH payload",
    async (body) => {
      const response = await patch(body);

      expect(response.status).toBe(400);
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

  it("updates one owner-visible feeding log", async () => {
    const client = createSupabaseClient();
    mocks.createClient.mockResolvedValue(client);
    const correction = {
      ended_on: "2026-08-12",
      food_id: 3,
      note: "정정",
      started_on: "2026-08-01",
    };

    const response = await patch(correction);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      feeding_log: { id: 7 },
    });
    expect(client.query.update).toHaveBeenCalledWith(correction);
    expect(client.query.eq).toHaveBeenCalledWith("id", 7);
  });

  it("returns 404 when RLS hides the row from PATCH", async () => {
    const client = createSupabaseClient({
      result: { data: null, error: null },
    });
    mocks.createClient.mockResolvedValue(client);

    const response = await patch({ note: "수정" });

    expect(response.status).toBe(404);
  });

  it.each(["23505", "23514"])(
    "maps database conflict %s to 409",
    async (code) => {
      const client = createSupabaseClient({
        result: { data: null, error: { code, message: "conflict" } },
      });
      mocks.createClient.mockResolvedValue(client);

      const response = await patch({ ended_on: "2026-08-01" });

      expect(response.status).toBe(409);
    },
  );

  it("deletes one owner-visible feeding log", async () => {
    const client = createSupabaseClient();
    mocks.createClient.mockResolvedValue(client);

    const response = await remove();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      feeding_log: { id: 7 },
    });
    expect(client.query.delete).toHaveBeenCalled();
    expect(client.query.eq).toHaveBeenCalledWith("id", 7);
  });

  it("returns 404 when RLS hides the row from DELETE", async () => {
    const client = createSupabaseClient({
      result: { data: null, error: null },
    });
    mocks.createClient.mockResolvedValue(client);

    const response = await remove();

    expect(response.status).toBe(404);
  });
});
