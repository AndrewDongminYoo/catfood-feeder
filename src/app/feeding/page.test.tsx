// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFeedingDashboard: vi.fn(),
  getFoods: vi.fn(),
}));

vi.mock("@/lib/feeding", () => ({
  getFeedingDashboard: mocks.getFeedingDashboard,
}));

vi.mock("@/lib/catalog", () => ({
  getFoods: mocks.getFoods,
}));

import FeedingPage from "./page";

describe("FeedingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFoods.mockResolvedValue([]);
  });

  afterEach(cleanup);

  it("shows an authenticated dashboard load error with a retry link", async () => {
    mocks.getFeedingDashboard.mockResolvedValue({
      cats: [],
      configured: true,
      error: "급여 기록을 불러오지 못했습니다.",
      insights: [],
      user: { id: "00000000-0000-0000-0000-000000000001" },
    });

    render(await FeedingPage());

    expect(screen.getByRole("alert").textContent).toContain(
      "급여 기록을 불러오지 못했습니다.",
    );
    expect(
      screen.getByRole("link", { name: "다시 시도" }).getAttribute("href"),
    ).toBe("/feeding");
    expect(screen.queryByRole("heading", { name: "교체 인사이트" })).toBeNull();
  });
});
