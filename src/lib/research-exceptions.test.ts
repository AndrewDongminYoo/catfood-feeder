import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import {
  loadResearchExceptions,
  toResearchException,
} from "./research-exceptions";

function clientReturning(rows: readonly unknown[]) {
  const query = {
    in: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: rows, error: null }),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return { from: vi.fn().mockReturnValue(query) };
}

describe("toResearchException", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the structured terminal reason when present", () => {
    expect(
      toResearchException({
        created_at: "2026-09-08T01:00:00Z",
        evidence_results: {
          outcomes: [],
          terminalReason: "capture_failed:network_error",
        },
        food_id: 7,
        foods: { brands: { name: "ACANA" }, product_name: "Grasslands" },
        id: 41,
        proposal: {},
        status: "capture_failed",
      }),
    ).toEqual({
      brandName: "ACANA",
      createdAt: "2026-09-08T01:00:00Z",
      foodId: 7,
      id: 41,
      productName: "Grasslands",
      reason: "capture_failed:network_error",
      status: "capture_failed",
    });
  });

  it("falls back to the status for historical rows", () => {
    expect(
      toResearchException({
        created_at: "2026-08-06T01:00:00Z",
        evidence_results: [],
        food_id: 8,
        foods: { brands: null, product_name: "Unknown" },
        id: 12,
        proposal: {},
        status: "invalid",
      }).reason,
    ).toBe("invalid");
  });

  it("returns a rejected run whose captured evidence was unusable", async () => {
    mocks.createAdminClient.mockReturnValue(
      clientReturning([
        {
          created_at: "2026-09-08T02:00:00Z",
          evidence_results: {
            outcomes: [{ status: "unverified" }],
            terminalReason: "evidence_rejected:unverified",
          },
          food_id: 9,
          foods: { brands: { name: "ACANA" }, product_name: "Rejected" },
          id: 42,
          proposal: {
            sources: [{ url: "https://example.com/rejected" }],
          },
          status: "rejected",
        },
        {
          created_at: "2026-09-08T01:00:00Z",
          evidence_results: [],
          food_id: 10,
          foods: { brands: { name: "ANF" }, product_name: "Transcript" },
          id: 41,
          proposal: { transcript: "등록성분량", values: {} },
          status: "rejected",
        },
      ]),
    );

    await expect(loadResearchExceptions()).resolves.toEqual([
      expect.objectContaining({
        id: 42,
        reason: "evidence_rejected:unverified",
        status: "rejected",
      }),
    ]);
  });
});
