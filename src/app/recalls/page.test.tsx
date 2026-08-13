// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRecalls: vi.fn(),
}));

vi.mock("@/lib/catalog", () => ({
  getRecalls: mocks.getRecalls,
}));

import RecallsPage from "./page";

const recall = {
  affected_lots: "LOT-1",
  brand_id: 10,
  classification: "Class II",
  external_id: "recall-1",
  food_id: null,
  id: 30,
  reason: "Example issue",
  recall_date: "2026-08-01",
  recalling_firm: "Example Firm",
  region: "US",
  source: "openFDA",
  source_url: "https://example.test/recall",
};

describe("RecallsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("labels brand history and qualifies product and lot applicability", async () => {
    mocks.getRecalls.mockResolvedValue([{ ...recall, scope: "brand" }]);

    render(await RecallsPage());

    expect(screen.getByText("브랜드 범위 이력")).toBeTruthy();
    expect(
      screen.getByText("이 제품·로트의 해당 여부는 확인되지 않았습니다."),
    ).toBeTruthy();
  });

  it("labels a recall that is not connected to a catalog entity", async () => {
    mocks.getRecalls.mockResolvedValue([
      { ...recall, brand_id: null, scope: "unlinked" },
    ]);

    render(await RecallsPage());

    expect(screen.getByText("카탈로그 미연결 이력")).toBeTruthy();
    expect(
      screen.getByText("카탈로그 제품·브랜드와의 연결이 확인되지 않았습니다."),
    ).toBeTruthy();
  });
});
