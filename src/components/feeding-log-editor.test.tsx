// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_FOODS } from "@/lib/fixtures";
import type { FeedingLog } from "@/lib/feeding";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

import { FeedingLogEditor } from "./feeding-log-editor";

const [currentFood] = SAMPLE_FOODS;
const nextFood = {
  ...currentFood,
  id: 1,
  product_name: "Next Recipe",
};
const log: FeedingLog = {
  ended_on: null,
  foods: {
    brand_id: currentFood.brand_id,
    brands: currentFood.brands
      ? { id: currentFood.brands.id, name: currentFood.brands.name }
      : null,
    carb_pct: currentFood.carb_pct,
    energy_c_pct: currentFood.energy_c_pct,
    energy_f_pct: currentFood.energy_f_pct,
    energy_p_pct: currentFood.energy_p_pct,
    fat_pct: currentFood.fat_pct,
    id: currentFood.id,
    kcal_per_kg: currentFood.kcal_per_kg,
    product_name: currentFood.product_name,
    protein_pct: currentFood.protein_pct,
    recalls: currentFood.recalls ?? [],
  },
  id: 7,
  note: "기존 메모",
  started_on: "2026-08-01",
};

describe("FeedingLogEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps correction controls collapsed until requested", () => {
    render(<FeedingLogEditor foods={[currentFood, nextFood]} log={log} />);

    const details = screen.getByText("기록 수정").closest("details");

    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
  });

  it("sends the corrected product, dates, and note through PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ feeding_log: { id: 7 } }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<FeedingLogEditor foods={[currentFood, nextFood]} log={log} />);

    fireEvent.change(screen.getByLabelText("제품"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("시작일"), {
      target: { value: "2026-08-02" },
    });
    fireEvent.change(screen.getByLabelText("종료일"), {
      target: { value: "2026-08-12" },
    });
    fireEvent.change(screen.getByLabelText("메모"), {
      target: { value: "정정 메모" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/feeding-logs/7", {
      body: JSON.stringify({
        ended_on: "2026-08-12",
        food_id: 1,
        note: "정정 메모",
        started_on: "2026-08-02",
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("confirms deletion and displays the server error without refreshing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "삭제할 수 없습니다." }), {
        headers: { "content-type": "application/json" },
        status: 409,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FeedingLogEditor foods={[currentFood, nextFood]} log={log} />);

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    expect(window.confirm).toHaveBeenCalled();
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe("삭제할 수 없습니다.");
    expect(fetchMock).toHaveBeenCalledWith("/api/feeding-logs/7", {
      method: "DELETE",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
