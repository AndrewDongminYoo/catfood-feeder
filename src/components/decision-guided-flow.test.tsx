// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionWorkspace } from "./decision-workspace";
import { SAMPLE_FOODS } from "@/lib/fixtures";

const props = {
  available: true,
  sample: false,
  foods: [
    {
      ...SAMPLE_FOODS[0]!,
      id: 1,
      product_name: "현재 사료",
      kcal_per_kg: 4000,
    },
    {
      ...SAMPLE_FOODS[0]!,
      id: 2,
      product_name: "닭고기 후보",
      kcal_per_kg: 3900,
      ingredients: [{ name: "Chicken meal", position: 1 }],
    },
  ],
  evidence: [
    [
      1,
      [
        {
          nutrient_key: "kcal_per_kg" as const,
          value: 4000,
          excerpt: "4000 kcal/kg",
          captured_at: "2026-10-01",
          source: {
            url: "https://example.test/current",
            capture_method: "fetch",
          },
        },
      ],
    ],
    [
      2,
      [
        {
          nutrient_key: "kcal_per_kg" as const,
          value: 3900,
          excerpt: "3900 kcal/kg",
          captured_at: "2026-10-01",
          source: { url: "https://example.test/next", capture_method: "fetch" },
        },
      ],
    ],
  ] as const,
  ingredientEvidenceByFoodId: {
    2: {
      excerpt: "Chicken meal",
      capturedAt: "2026-10-01",
      url: "https://example.test/next",
    },
  },
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
describe("guided food decision", () => {
  it("preserves manually added preferences when a revised question repeats poultry preference", async () => {
    render(<DecisionWorkspace {...props} />);
    fireEvent.change(screen.getByLabelText("현재 먹는 사료"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByLabelText(/성묘의 일반 건사료/));
    fireEvent.click(
      screen.getByRole("button", { name: "다음: 바꾸려는 이유" }),
    );
    fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
      target: { value: "가금육을 선호하고 열량 차이는 10% 이내로 찾아요." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "조건을 직접 정할게요" }),
    );
    fireEvent.click(screen.getByLabelText("생선 선호"));
    fireEvent.click(
      screen.getByRole("button", { name: "이전: 바꾸려는 이유" }),
    );
    fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
      target: {
        value: "가금육을 선호하고 열량 차이는 10% 이내로 다른 사료를 찾아요.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "조건을 직접 정할게요" }),
    );
    expect(
      (screen.getByLabelText("생선 선호") as HTMLInputElement).checked,
    ).toBe(true);
  });
  it.each(["조건을 직접 정할게요", "질문에서 조건 읽기"])(
    "preserves an explicitly chosen exclusion after cosmetic question edits via %s",
    async (route) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      render(<DecisionWorkspace {...props} />);
      fireEvent.change(screen.getByLabelText("현재 먹는 사료"), {
        target: { value: "1" },
      });
      fireEvent.click(screen.getByLabelText(/성묘의 일반 건사료/));
      fireEvent.click(
        screen.getByRole("button", { name: "다음: 바꾸려는 이유" }),
      );
      fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
        target: { value: "열량 차이 10% 이내로 찾아요." },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "조건을 직접 정할게요" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "피해야 할 원료도 정할게요" }),
      );
      fireEvent.click(screen.getByLabelText("닭고기 표기 제외"));
      fireEvent.click(
        screen.getByLabelText("현재 사료보다 열량이 높지 않은 후보"),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "이전: 바꾸려는 이유" }),
      );
      fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
        target: { value: "열량 차이 10% 이내로 다른 사료를 찾아요." },
      });
      fireEvent.click(screen.getByRole("button", { name: route }));
      await screen.findByRole("button", {
        name: "조건 확인하고 후보 비교하기",
      });
      expect(
        (screen.getByLabelText("닭고기 표기 제외") as HTMLInputElement).checked,
      ).toBe(true);
      expect(
        (
          screen.getByLabelText(
            "현재 사료보다 열량이 높지 않은 후보",
          ) as HTMLInputElement
        ).checked,
      ).toBe(true);
      fireEvent.click(
        screen.getByRole("button", { name: "조건 확인하고 후보 비교하기" }),
      );
      expect(screen.getByText(/조건이 맞지 않은 1개 제품/)).toBeTruthy();
    },
  );
  it("keeps the active question stable while interpretation is pending", async () => {
    let rejectRequest!: (reason: Error) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((_, reject) => {
            rejectRequest = reject;
          }),
      ),
    );
    render(<DecisionWorkspace {...props} />);
    fireEvent.change(screen.getByLabelText("현재 먹는 사료"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByLabelText(/성묘의 일반 건사료/));
    fireEvent.click(
      screen.getByRole("button", { name: "다음: 바꾸려는 이유" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "지금과 비슷한 다른 사료를 찾고 있어요",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "질문에서 조건 읽기" }));
    for (const label of [
      "이전: 현재 사료",
      "조건을 직접 정할게요",
      "피해야 할 원료가 있어요",
    ]) {
      expect(
        (screen.getByRole("button", { name: label }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    }
    expect(
      (
        screen.getByLabelText(
          "다음 사료에 대해 궁금한 점",
        ) as HTMLTextAreaElement
      ).disabled,
    ).toBe(true);
    rejectRequest(new Error("offline"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "조건 확인하고 후보 비교하기" }),
      ).toBeTruthy(),
    );
  });

  it("lets owners set conditions without a model request and preserves them when returning to the same question", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<DecisionWorkspace {...props} />);
    fireEvent.change(screen.getByLabelText("현재 먹는 사료"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByLabelText(/성묘의 일반 건사료/));
    fireEvent.click(
      screen.getByRole("button", { name: "다음: 바꾸려는 이유" }),
    );
    fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
      target: { value: "열량은 비슷하게, 닭고기는 피하고 싶어요." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "조건을 직접 정할게요" }),
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("닭고기 표기 제외") as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("닭고기 표기 제외"));
    fireEvent.click(
      screen.getByRole("button", { name: "지금과 비슷하게 · 차이 10% 이내" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "이전: 바꾸려는 이유" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "확인한 조건으로 돌아가기" }),
    );
    expect(
      (screen.getByLabelText("닭고기 표기 제외") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      screen.queryByRole("button", { name: "이 열량 기준으로 비교하기" }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts with the current food and asks a reason before showing comparison settings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props} />);
    expect(
      screen.queryByRole("button", { name: "조건 확인하고 후보 비교하기" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("현재 먹는 사료"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByLabelText(/성묘의 일반 건사료/));
    fireEvent.click(
      screen.getByRole("button", { name: "다음: 바꾸려는 이유" }),
    );
    expect(
      screen.getByRole("heading", { name: "어떤 점을 바꾸고 싶나요?" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "좋아하는 원료를 먼저 볼래요" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "질문에서 조건 읽기" }));
    await screen.findByRole("heading", { name: "어떤 원료를 더 좋아하나요?" });
    expect(screen.queryByLabelText("닭고기 표기 제외")).toBeNull();
    fireEvent.click(screen.getByLabelText("가금육 선호"));
    fireEvent.click(
      screen.getByRole("button", { name: "이 열량 기준으로 비교하기" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "조건 확인하고 후보 비교하기" }),
    );
    expect(screen.getByRole("heading", { name: "닭고기 후보" })).toBeTruthy();
    expect(screen.getByText("먼저 살펴볼 이유")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("선택 또는 보류 이유"), {
      target: { value: "선호한 원료가 앞에 표기돼 후보로 남김" },
    });
    fireEvent.click(screen.getByRole("button", { name: "검토 기록 저장하기" }));
    const saved = JSON.parse(localStorage.getItem("catfood.decisions.v1")!)[0];
    expect(saved.report.request.preferredProteins).toEqual(["poultry"]);
    expect(saved.report.request.exclusions).toEqual([]);
    expect(saved.report.request.changeReason).toBe(
      "좋아하는 원료를 먼저 볼래요",
    );
  });
});
