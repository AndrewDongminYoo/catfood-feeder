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
import {
  decisionSnapshotSchema,
  exportDecisionBrief,
} from "@/lib/food-decision";
import { projectAdequacy } from "@/lib/adequacy-evidence";
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

async function prepare(question = "열량 차이는 10% 이내로 찾아주세요") {
  fireEvent.change(screen.getByLabelText("현재 먹는 사료"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByLabelText(/성묘의 일반 건사료/));
  fireEvent.click(screen.getByRole("button", { name: "다음: 바꾸려는 이유" }));
  fireEvent.change(screen.getByLabelText("다음 사료에 대해 궁금한 점"), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "질문에서 조건 읽기" }));
  await screen.findByRole("button", { name: "조건 확인하고 후보 비교하기" });
}
function compare() {
  fireEvent.click(
    screen.getByRole("button", { name: "조건 확인하고 후보 비교하기" }),
  );
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "검토 기록 저장하기" }));
}
function edit() {
  fireEvent.click(screen.getByRole("button", { name: "조건 바꾸기" }));
}
const originalQuestion =
  "지금 먹이는 사료와 비슷하면서 열량이 너무 높지 않은 건강한 사료를 찾고 있어요. 생선보다는 가금육을 더 좋아해요.";

describe("decision workspace", () => {
  it("keeps an unverified ingredient percentage unresolved instead of applying it to calories", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    await prepare("열량은 비슷하고 닭고기 함량 20% 이내인 사료");
    compare();
    save();
    const saved = JSON.parse(localStorage.getItem("catfood.decisions.v1")!)[0];
    expect(saved.report.request.unresolvedRequirements.join(" ")).toContain(
      "비율 조건",
    );
    expect(saved.report.eligible).toHaveLength(0);
  });
  it("uses and saves a percentage before the calorie term instead of the ten-percent default", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const data = props();
    data.foods[1]!.kcal_per_kg = 4360;
    data.evidence[1] = [2, [kcal(4360)]];
    render(<DecisionWorkspace {...data} />);
    await prepare("현재 사료와 8% 이내로 열량 차이가 나는 사료");
    expect(
      (
        screen.getByLabelText(
          "현재 사료와 허용할 열량 차이",
        ) as HTMLSelectElement
      ).value,
    ).toBe("8");
    compare();
    save();
    const saved = JSON.parse(localStorage.getItem("catfood.decisions.v1")!)[0];
    expect(saved.report.request.maxKcalDeltaPct).toBe(8);
    expect(saved.report.request.pendingClarifications).toEqual([]);
    expect(saved.report.eligible).toHaveLength(0);
    expect(
      saved.report.excluded.map((c: { food: { id: number } }) => c.food.id),
    ).toEqual([2]);
  });
  it("preserves unavailable ingredient evidence in initial, saved, and exported briefs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const data = { ...props(), ingredientEvidenceUnavailable: true };
    const view = render(<DecisionWorkspace {...data} />);
    await prepare();
    compare();
    expect(
      screen.getByText(/원재료 근거 자료를 불러오지 못했어요/),
    ).toBeTruthy();
    expect(screen.getByText("+5.0%")).toBeTruthy();
    save();
    const saved = JSON.parse(localStorage.getItem("catfood.decisions.v1")!)[0];
    expect(saved.report.ingredientEvidenceUnavailable).toBe(true);
    expect(exportDecisionBrief(decisionSnapshotSchema.parse(saved))).toContain(
      "원재료 근거 자료: 이 검토에서는 불러오지 못했습니다",
    );
    const legacy = structuredClone(saved);
    delete legacy.report.ingredientEvidenceUnavailable;
    expect(
      decisionSnapshotSchema.parse(legacy).report.ingredientEvidenceUnavailable,
    ).toBe(false);
    view.unmount();
    render(<DecisionWorkspace {...props()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /저장한 검토 불러오기/ }),
    );
    expect(
      screen.getByText(/원재료 근거 자료를 불러오지 못했어요/),
    ).toBeTruthy();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...props(), ingredientEvidenceUnavailable: false }),
    } as Response);
    fireEvent.click(
      screen.getByRole("button", { name: "현재 자료로 다시 비교하기" }),
    );
    await screen.findByText(/현재 카탈로그로 다시 비교했습니다/);
    expect(
      screen.queryByText(/원재료 근거 자료를 불러오지 못했어요/),
    ).toBeNull();
    save();
    const refreshed = JSON.parse(localStorage.getItem("catfood.decisions.v1")!);
    expect(refreshed[0].report.ingredientEvidenceUnavailable).toBe(false);
    expect(refreshed[1].report.ingredientEvidenceUnavailable).toBe(true);
  });
  it.each([false, true])(
    "preserves captured ingredient proof when a fresh read fails (HTTP ok: %s)",
    async (ok) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      const data = props();
      const proof = {
        excerpt: data.foods[1]!.ingredients.map((i) => i.name).join(", "),
        capturedAt: "2026-10-01",
        url: "https://example.test/ingredients",
      };
      render(
        <DecisionWorkspace
          {...data}
          ingredientEvidenceByFoodId={{ 2: proof }}
        />,
      );
      await prepare();
      compare();
      save();
      const before = JSON.parse(
        localStorage.getItem("catfood.decisions.v1")!,
      )[0];
      expect(before.report.eligible[0].ingredientEvidence).toEqual(proof);
      vi.mocked(fetch).mockResolvedValueOnce({
        ok,
        json: async () => ({
          ...data,
          ingredientEvidenceUnavailable: true,
          ingredientEvidenceByFoodId: {},
        }),
      } as Response);
      fireEvent.click(
        screen.getByRole("button", { name: "현재 자료로 다시 비교하기" }),
      );
      await screen.findByText(
        /표시 중인 검토와 자료 시점은 그대로 유지했습니다/,
      );
      save();
      expect(
        JSON.parse(localStorage.getItem("catfood.decisions.v1")!)[0].report,
      ).toEqual(before.report);
    },
  );
  it.each([5, 10, 15])(
    "confirms pending calories through sensitivity selection (%s)",
    async (delta) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      render(<DecisionWorkspace {...props()} />);
      await prepare("열량이 비슷한 사료로 찾아요");
      compare();
      expect(
        screen.getByText("선택을 막는 정보부터 확인해 보세요"),
      ).toBeTruthy();
      fireEvent.click(screen.getByText("열량 기준을 바꾸며 더 비교하기"));
      const sensitivity = screen.getByRole("button", {
        name: new RegExp(`^${delta}% 이내.*이 조건으로 다시 비교`),
      });
      expect(sensitivity.textContent).toContain("1개");
      fireEvent.click(sensitivity);
      expect(
        screen.getByRole("heading", { name: /먼저 살펴볼 후보 1개/ }),
      ).toBeTruthy();
      save();
      const saved = JSON.parse(
        localStorage.getItem("catfood.decisions.v1")!,
      )[0];
      expect(saved.report.request.pendingClarifications).toEqual([]);
      expect(saved.report.request.maxKcalDeltaPct).toBe(delta);
      expect(
        saved.report.eligible.map(
          (candidate: { food: { id: number } }) => candidate.food.id,
        ),
      ).toEqual([2]);
    },
  );
  it("keeps other pending criteria when sensitivity confirms calories", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    await prepare("열량은 비슷하고 가금육을 선호해요");
    compare();
    fireEvent.click(screen.getByText("열량 기준을 바꾸며 더 비교하기"));
    expect(
      screen.getByRole("button", { name: /^10% 이내.*이 조건으로 다시 비교/ })
        .textContent,
    ).toContain("0개");
    fireEvent.click(
      screen.getByRole("button", { name: /^10% 이내.*이 조건으로 다시 비교/ }),
    );
    save();
    const saved = JSON.parse(localStorage.getItem("catfood.decisions.v1")!)[0];
    expect(saved.report.request.pendingClarifications).toEqual(["poultry"]);
    expect(saved.report.eligible).toHaveLength(0);
  });
  it("keeps initial comparisons usable and preserves unavailable declarations in saved briefs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const data = { ...props(), adequacyUnavailable: true };
    const view = render(<DecisionWorkspace {...data} />);
    await prepare();
    compare();
    expect(screen.getByText("+5.0%")).toBeTruthy();
    expect(
      screen.getByText(/지금은 선언 자료를 불러오지 못했어요/),
    ).toBeTruthy();
    expect(
      screen.queryByText(/확보한 자료에서 선언을 확인하지 못했어요/),
    ).toBeNull();
    save();
    const saved = JSON.parse(localStorage.getItem("catfood.decisions.v1")!)[0];
    expect(saved.report.adequacyUnavailable).toBe(true);
    expect(exportDecisionBrief(decisionSnapshotSchema.parse(saved))).toContain(
      "이 검토에서는 불러오지 못했습니다",
    );
    const legacy = structuredClone(saved);
    delete legacy.report.adequacyUnavailable;
    expect(
      decisionSnapshotSchema.parse(legacy).report.adequacyUnavailable,
    ).toBe(false);
    view.unmount();
    render(<DecisionWorkspace {...props()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /저장한 검토 불러오기/ }),
    );
    expect(
      screen.getByText(/지금은 선언 자료를 불러오지 못했어요/),
    ).toBeTruthy();
    expect(screen.getByText("+5.0%")).toBeTruthy();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...props(), adequacyUnavailable: false }),
    } as Response);
    fireEvent.click(
      screen.getByRole("button", { name: "현재 자료로 다시 비교하기" }),
    );
    await screen.findByText(
      "현재 카탈로그로 다시 비교했습니다. 이전에 저장한 기록은 그대로 남아 있습니다.",
    );
    expect(
      screen.queryByText(/지금은 선언 자료를 불러오지 못했어요/),
    ).toBeNull();
    expect(
      screen.getByText(/확보한 자료에서 선언을 확인하지 못했어요/),
    ).toBeTruthy();
    save();
    const refreshed = JSON.parse(localStorage.getItem("catfood.decisions.v1")!);
    expect(refreshed[0].report.adequacyUnavailable).toBe(false);
    expect(refreshed[1].report.adequacyUnavailable).toBe(true);
  });
  it.each([false, true])(
    "preserves captured declarations when a fresh response is incomplete (HTTP ok: %s)",
    async (ok) => {
      const proof = projectAdequacy({
        statement:
          "Example Cat Food is formulated to meet the nutritional levels established by the AAFCO Cat Food Nutrient Profiles for all life stages.",
        source_product_name: "Example Cat Food",
        captured_at: "2026-08-08T00:00:00Z",
        applied_by_origin: "automation",
        food_sources: { url: "https://example.test/cat" },
      })!;
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      render(
        <DecisionWorkspace {...props()} adequacyByFoodId={{ 2: [proof] }} />,
      );
      await prepare();
      compare();
      save();
      const before = JSON.parse(
        localStorage.getItem("catfood.decisions.v1")!,
      )[0];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok,
        json: async () => ({
          ...props(),
          adequacyUnavailable: true,
          adequacyByFoodId: {},
        }),
      } as Response);
      fireEvent.click(
        screen.getByRole("button", { name: "현재 자료로 다시 비교하기" }),
      );
      await screen.findByText(
        /표시 중인 검토와 자료 시점은 그대로 유지했습니다/,
      );
      expect(screen.getByText(proof.statement)).toBeTruthy();
      expect(screen.getByText("+5.0%")).toBeTruthy();
      save();
      expect(
        JSON.parse(localStorage.getItem("catfood.decisions.v1")!)[0].report,
      ).toEqual(before.report);
    },
  );
  it.each(["refresh", "sensitivity"])(
    "keeps confirmed and omitted criteria through %s",
    async (action) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockRejectedValueOnce(new Error("offline"))
          .mockResolvedValue({ ok: true, json: async () => props() }),
      );
      render(<DecisionWorkspace {...props()} />);
      await prepare(originalQuestion);
      compare();
      edit();
      fireEvent.click(
        screen.getByRole("button", { name: "이 열량 기준으로 비교하기" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "이 선호로 후보 먼저 보기" }),
      );
      fireEvent.click(
        screen.getByLabelText(/이 요구를 이번 비교에서 제외하기/),
      );
      compare();
      if (action === "refresh") {
        fireEvent.click(
          screen.getByRole("button", { name: "현재 자료로 다시 비교하기" }),
        );
        await screen.findByText(
          "현재 카탈로그로 다시 비교했습니다. 이전에 저장한 기록은 그대로 남아 있습니다.",
        );
      } else {
        fireEvent.click(screen.getByText("열량 기준을 바꾸며 더 비교하기"));
        fireEvent.click(
          screen.getByRole("button", {
            name: /^5% 이내.*이 조건으로 다시 비교/,
          }),
        );
      }
      save();
      const request = JSON.parse(
        localStorage.getItem("catfood.decisions.v1")!,
      )[0].report.request;
      expect(request.pendingClarifications).toEqual([]);
      expect(request.unresolvedRequirements).toEqual([]);
      expect(request.ignoredRequirements).toHaveLength(1);
      expect(request.preferredProteins).toEqual(["poultry"]);
      expect(request.poultryFirst).toBe(false);
    },
  );
  it("keeps qualitative criteria pending until confirmed and treats poultry as a preference", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    await prepare(originalQuestion);
    expect(
      (screen.getByLabelText("가금육 선호") as HTMLInputElement).checked,
    ).toBe(true);
    compare();
    expect(screen.getByText("선택을 막는 정보부터 확인해 보세요")).toBeTruthy();
    edit();
    fireEvent.click(
      screen.getByRole("button", { name: "이 열량 기준으로 비교하기" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "이 선호로 후보 먼저 보기" }),
    );
    expect(
      screen.queryByRole("button", { name: "이 열량 기준으로 비교하기" }),
    ).toBeNull();
    expect(
      screen.queryByLabelText("가금육이 생선보다 먼저 표기된 후보"),
    ).toBeNull();
    expect(
      screen.getByLabelText(/이 요구를 이번 비교에서 제외하기/),
    ).toBeTruthy();
  });
  it("restores the unsupported-requirement editor without another interpretation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const view = render(<DecisionWorkspace {...props()} />);
    await prepare("완두콩 표기는 제외해 주세요");
    compare();
    save();
    view.unmount();
    render(<DecisionWorkspace {...props()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /저장한 검토 불러오기/ }),
    );
    edit();
    expect(
      screen.getByLabelText(/이 요구를 이번 비교에서 제외하기/),
    ).toBeTruthy();
  });
  it("reads changed server evidence before claiming to recheck current data", async () => {
    const changed = props();
    changed.foods[1]!.kcal_per_kg = 4900;
    changed.evidence[1]![1] = [kcal(4900)];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ok: true, json: async () => changed }),
    );
    render(<DecisionWorkspace {...props()} />);
    await prepare();
    compare();
    fireEvent.click(
      screen.getByRole("button", { name: "현재 자료로 다시 비교하기" }),
    );
    for (const name of ["조건 바꾸기", "현재 사료 바꾸기"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    await screen.findByText(/열량 차이 10% 이내: 현재 대비 \+22.5%/);
    expect(screen.getByText(/조건이 맞지 않은 1개 제품/)).toBeTruthy();
  });
  it("takes a chosen candidate to the reason field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    await prepare();
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
  it("shows the signed energy difference and original source links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    await prepare();
    compare();
    expect(
      screen.getByRole("heading", { name: /먼저 비교할 후보/ }),
    ).toBeTruthy();
    expect(screen.getByText("+5.0%")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: /원문/ }).length,
    ).toBeGreaterThan(0);
  });
  it("saves and restores the exact brief after the catalog changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const view = render(<DecisionWorkspace {...props()} />);
    await prepare();
    compare();
    fireEvent.change(screen.getByLabelText("선택 또는 보류 이유"), {
      target: { value: "현재 사료와 열량이 비슷해서" },
    });
    save();
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
    expect(screen.getByText(/저장 당시의 자료입니다/)).toBeTruthy();
  });
  it("keeps a usable guided path when storage is denied", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    render(<DecisionWorkspace {...props()} />);
    expect(
      screen.getByText(/브라우저에 기록을 저장할 수 없습니다/),
    ).toBeTruthy();
    await prepare();
    compare();
    expect(
      screen.getByRole("heading", { name: /먼저 비교할 후보/ }),
    ).toBeTruthy();
  });
  it("preserves the question and editable exclusions when interpretation fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    await prepare("닭고기 없는 사료");
    expect(
      (screen.getByLabelText("닭고기 표기 제외") as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "이전: 바꾸려는 이유" }),
    );
    expect(
      (
        screen.getByLabelText(
          "다음 사료에 대해 궁금한 점",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("닭고기 없는 사료");
  });
  it.each([
    ["no chicken or fish", "생선", "fish"],
    ["닭고기와 소고기를 빼주세요", "소고기", "beef"],
  ])(
    "saves and enforces both offline exclusions: %s",
    async (question, ingredient, key) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      const data = props();
      data.foods[1]!.ingredients = [{ name: ingredient, position: 1 }];
      render(
        <DecisionWorkspace
          {...data}
          ingredientEvidenceByFoodId={{
            2: {
              excerpt: ingredient,
              capturedAt: "2026-10-01",
              url: "https://example.test/ingredients",
            },
          }}
        />,
      );
      await prepare(question);
      expect(
        (screen.getByLabelText("닭고기 표기 제외") as HTMLInputElement).checked,
      ).toBe(true);
      expect(
        (screen.getByLabelText(`${ingredient} 표기 제외`) as HTMLInputElement)
          .checked,
      ).toBe(true);
      compare();
      save();
      const saved = JSON.parse(
        localStorage.getItem("catfood.decisions.v1")!,
      )[0];
      expect(saved.report.request.exclusions).toEqual(["chicken", key]);
      expect(saved.report.eligible).toHaveLength(0);
      expect(saved.report.unresolved).toHaveLength(0);
      expect(saved.report.excluded).toHaveLength(1);
      expect(saved.report.excluded[0].conditions).toContainEqual(
        expect.objectContaining({ key, status: "failed" }),
      );
    },
  );
  it("requires an explicit omission of an unsupported exclusion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<DecisionWorkspace {...props()} />);
    await prepare("완두콩 표기는 제외해 주세요");
    compare();
    expect(screen.getByText("선택을 막는 정보부터 확인해 보세요")).toBeTruthy();
    edit();
    fireEvent.click(screen.getByLabelText(/이 요구를 이번 비교에서 제외하기/));
    compare();
    expect(screen.getByText("먼저 살펴볼 후보 1개를 골랐어요")).toBeTruthy();
  });
});
