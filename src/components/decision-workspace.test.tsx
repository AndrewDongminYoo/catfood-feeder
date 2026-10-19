// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_FOODS } from "@/lib/fixtures";
import type { NutrientEvidence } from "@/lib/catalog";
import { DecisionWorkspace } from "./decision-workspace";

const kcal = (value: number): NutrientEvidence => ({
  nutrient_key: "kcal_per_kg",
  value,
  excerpt: `${value} kcal/kg`,
  captured_at: "2026-10-01",
  source: { url: "https://example.test/label", capture_method: "fetch" },
});
function props() {
  return {
    available: true,
    sample: false,
    foods: [
      {
        ...SAMPLE_FOODS[0]!,
        id: 1,
        product_name: "지금 먹는 사료",
        kcal_per_kg: 4000,
      },
      {
        ...SAMPLE_FOODS[0]!,
        id: 2,
        product_name: "비교할 사료",
        kcal_per_kg: 4200,
      },
    ],
    evidence: [
      [1, [kcal(4000)]],
      [2, [kcal(4200)]],
    ] as [number, NutrientEvidence[]][],
    ingredientEvidenceByFoodId: {},
  };
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function compare() {
  fireEvent.change(screen.getByLabelText("현재 먹는 사료"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByLabelText(/성묘의 일반 건사료/));
  fireEvent.click(
    screen.getByRole("button", { name: "조건 확인하고 후보 비교하기" }),
  );
}

describe("decision workspace", () => {
  it.each(["refresh", "sensitivity"])(
    "keeps just-confirmed conditions when applying %s",
    async (action) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockRejectedValueOnce(new Error("offline"))
          .mockResolvedValue({ ok: true, json: async () => props() }),
      );
      render(<DecisionWorkspace {...props()} />);
      fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
        target: {
          value:
            "열량이 너무 높지 않은 건강한 사료를 찾아요. 가금육을 더 좋아해요.",
        },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "질문에서 조건 읽기" }),
      );
      await screen.findByRole("button", { name: "이 열량 기준으로 비교하기" });
      compare();
      fireEvent.click(
        screen.getByRole("button", { name: "이 열량 기준으로 비교하기" }),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "이 원재료 순서 기준으로 비교하기",
        }),
      );
      fireEvent.click(
        screen.getByLabelText(/이 요구를 이번 비교에서 제외하기/),
      );
      if (action === "refresh") {
        fireEvent.click(
          screen.getByRole("button", { name: "현재 자료로 다시 비교하기" }),
        );
        await screen.findByText(
          "현재 카탈로그로 다시 비교했습니다. 이전에 저장한 기록은 그대로 남아 있습니다.",
        );
      } else
        fireEvent.click(
          screen.getByRole("button", {
            name: /^5% 이내.*이 조건으로 다시 비교/,
          }),
        );
      fireEvent.click(
        screen.getByRole("button", { name: "검토 기록 저장하기" }),
      );
      const saved = JSON.parse(localStorage.getItem("catfood.decisions.v1")!)[0]
        .report.request;
      expect(saved.pendingClarifications).toEqual([]);
      expect(saved.unresolvedRequirements).toEqual([]);
      expect(saved.ignoredRequirements).toHaveLength(1);
    },
  );
  it("requires explicit calorie and poultry confirmation for the actual owner question", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
      target: {
        value:
          "지금 먹이는 사료와 비슷하면서 열량이 너무 높지 않은 건강한 사료를 찾고 있어요. 생선보다는 가금육을 더 좋아해요.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "질문에서 조건 읽기" }));
    await screen.findByRole("button", { name: "이 열량 기준으로 비교하기" });
    compare();
    expect(screen.getByText("선택을 막는 정보부터 확인해 보세요")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "이 열량 기준으로 비교하기" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "이 원재료 순서 기준으로 비교하기" }),
    );
    expect(
      screen.queryByRole("button", { name: "이 열량 기준으로 비교하기" }),
    ).toBeNull();
    expect(
      (
        screen.getByLabelText(
          "현재 사료보다 열량이 높지 않은 후보",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByLabelText(
          "가금육이 생선보다 먼저 표기된 후보",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      screen.getByLabelText(/이 요구를 이번 비교에서 제외하기/),
    ).toBeTruthy();
  });
  it("restores the unsupported-requirement editor without another model call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const view = render(<DecisionWorkspace {...props()} />);
    fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
      target: { value: "완두콩 표기는 제외해 주세요" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질문에서 조건 읽기" }));
    await screen.findByLabelText(/이 요구를 이번 비교에서 제외하기/);
    compare();
    fireEvent.click(screen.getByRole("button", { name: "검토 기록 저장하기" }));
    view.unmount();
    render(<DecisionWorkspace {...props()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /저장한 검토 불러오기/ }),
    );
    expect(
      screen.getByLabelText(/이 요구를 이번 비교에서 제외하기/),
    ).toBeTruthy();
  });
  it("fetches changed server evidence before claiming to recheck current data", async () => {
    const changed = props();
    changed.foods[1]!.kcal_per_kg = 4900;
    changed.evidence[1]![1] = [kcal(4900)];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => changed }),
    );
    render(<DecisionWorkspace {...props()} />);
    compare();
    fireEvent.click(
      screen.getByRole("button", { name: "현재 자료로 다시 비교하기" }),
    );
    await screen.findByText(/열량 차이 10% 이내: 현재 대비 \+22.5%/);
    expect(screen.getByText(/조건이 맞지 않은 1개 제품/)).toBeTruthy();
  });
  it("takes a chosen candidate to the reason field without making the owner search for the next step", () => {
    render(<DecisionWorkspace {...props()} />);
    compare();
    fireEvent.click(
      screen.getByRole("button", { name: "이 후보를 검토 기록에 담기" }),
    );
    expect(
      (
        screen.getByLabelText(
          "다음에 확인하거나 구매할 후보",
        ) as HTMLSelectElement
      ).value,
    ).toBe("2");
    expect(document.activeElement).toBe(
      screen.getByLabelText("선택 또는 보류 이유"),
    );
  });
  it("produces a usable comparison with the signed energy change and source links", () => {
    render(<DecisionWorkspace {...props()} />);
    compare();
    expect(
      screen.getByRole("heading", { name: /입력한 조건을 충족한 후보/ }),
    ).toBeTruthy();
    expect(screen.getByText("+5.0%")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: /원문/ }).length,
    ).toBeGreaterThan(0);
  });
  it("saves the exact brief and restores it after the catalog changes", async () => {
    const view = render(<DecisionWorkspace {...props()} />);
    compare();
    fireEvent.change(screen.getByLabelText("선택 또는 보류 이유"), {
      target: { value: "현재 사료와 열량이 비슷해서" },
    });
    fireEvent.click(screen.getByRole("button", { name: "검토 기록 저장하기" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /저장한 검토 불러오기/ }),
      ).toBeTruthy(),
    );
    view.unmount();
    const changed = props();
    changed.foods[1]!.kcal_per_kg = 4900;
    render(<DecisionWorkspace {...changed} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /저장한 검토 불러오기/ }),
    );
    expect(screen.getByText("+5.0%")).toBeTruthy();
    expect(
      (screen.getByLabelText("선택 또는 보류 이유") as HTMLTextAreaElement)
        .value,
    ).toBe("현재 사료와 열량이 비슷해서");
    expect(screen.getByText(/저장 당시의 자료입니다\./)).toBeTruthy();
  });
  it("keeps an actionable page when browser storage is denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    render(<DecisionWorkspace {...props()} />);
    expect(
      screen.getByText(/브라우저에 기록을 저장할 수 없습니다/),
    ).toBeTruthy();
    compare();
    expect(
      screen.getByRole("heading", { name: /입력한 조건을 충족한 후보/ }),
    ).toBeTruthy();
  });
  it("preserves a question when AI is unavailable and exposes editable fallback conditions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
      target: { value: "닭고기 없는 사료" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질문에서 조건 읽기" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("닭고기 표기 제외") as HTMLInputElement).checked,
      ).toBe(true),
    );
    expect(
      (
        screen.getByLabelText(
          "다음 사료에 대해 궁금한 점",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("닭고기 없는 사료");
    vi.unstubAllGlobals();
  });
  it("keeps an unsupported exclusion unresolved after AI failure until the owner explicitly omits it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
      target: { value: "완두콩 표기는 제외해 주세요" },
    });
    fireEvent.click(screen.getByRole("button", { name: "질문에서 조건 읽기" }));
    await screen.findByText("이 요구는 아직 확인하지 못했습니다");
    compare();
    expect(screen.getByText("선택을 막는 정보부터 확인해 보세요")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/이 요구를 이번 비교에서 제외하기/));
    fireEvent.click(
      screen.getByRole("button", { name: "조건 확인하고 후보 비교하기" }),
    );
    expect(
      screen.getByText("비교할 후보와 선택의 근거가 모였습니다"),
    ).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
