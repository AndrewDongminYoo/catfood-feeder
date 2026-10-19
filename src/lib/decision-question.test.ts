import { describe, expect, it } from "vitest";
import { buildFoodDecision, DEFAULT_DECISION_REQUEST } from "./food-decision";
import { SAMPLE_FOODS } from "./fixtures";
import {
  parseDecisionQuestion,
  validateQuestionProposal,
} from "./decision-question";

describe("decision question", () => {
  it("does not invert a minimum calorie reduction into a maximum difference", () => {
    const result = parseDecisionQuestion("열량이 현재보다 10% 이상 낮은 사료");
    expect(result.maxKcalDeltaPct).toBeNull();
    expect(result.unhandled.join(" ")).toContain("열량");
  });
  it("keeps unsupported nutrient ranking even beside a recognized exclusion", () => {
    expect(
      parseDecisionQuestion("닭고기 없는 고단백 사료").unhandled.join(" "),
    ).toContain("보증성분");
  });
  it("preserves an unsupported exclusion beside a recognized exclusion", () => {
    expect(
      parseDecisionQuestion(
        "닭고기 없는 사료로, 돼지고기도 제외해 주세요",
      ).unhandled.join(" "),
    ).toContain("제외");
  });
  it("keeps an unrecognized free-text preference unresolved", () => {
    expect(
      parseDecisionQuestion("작은 알갱이로 추천해 주세요").unhandled.length,
    ).toBeGreaterThan(0);
  });
  it.each([
    "닭고기 없는 작은 알갱이 사료를 추천해 주세요",
    "열량 차이 10% 이내이고 작은 알갱이 사료를 추천해 주세요",
    "열량은 비슷하고 가금육을 좋아하지만 작은 입자를 원해요",
    "no chicken and small kibble please",
  ])(
    "preserves unsupported physical attributes alongside supported conditions: %s",
    (question) => {
      expect(parseDecisionQuestion(question).unhandled.join(" ")).toContain(
        "알갱이",
      );
    },
  );
  it("retains the exact requested calorie tolerance rather than defaulting to ten", () => {
    expect(
      parseDecisionQuestion("열량 차이는 8% 이내로 해주세요").maxKcalDeltaPct,
    ).toBe(8);
    expect(
      parseDecisionQuestion("열량 차이는 2.5% 이내로요").maxKcalDeltaPct,
    ).toBe(2.5);
  });
  it("asks for calorie and poultry-label confirmation for the owner's actual question", () => {
    const result = parseDecisionQuestion(
      "지금 먹이는 사료와 비슷하면서 열량이 너무 높지 않은 건강한 사료를 찾고 있어요. 생선보다는 가금육을 더 좋아해요.",
    );
    expect(result).toMatchObject({
      clarifications: ["calories", "poultry"],
      notHigherKcal: true,
    });
    expect(result.unhandled.join(" ")).toContain("건강");
    expect(result.exclusions).toEqual([]);
  });
  it("extracts explicit exclusions and a supported calorie tolerance", () => {
    expect(
      parseDecisionQuestion(
        "닭고기 없는 사료로 바꾸고 싶어요. 열량 차이는 5% 이내로요.",
      ),
    ).toMatchObject({ exclusions: ["chicken"], maxKcalDeltaPct: 5 });
  });
  it("does not turn a mention or a negated exclusion into a hard exclusion", () => {
    expect(
      parseDecisionQuestion("닭고기를 먹고 있어요. 소고기는 빼고 싶어요.")
        .exclusions,
    ).toEqual(["beef"]);
    expect(
      parseDecisionQuestion("닭고기는 빼지 않아도 돼요").exclusions,
    ).toEqual([]);
    expect(
      parseDecisionQuestion("닭고기를 먹고 있어요. 그레인프리로 바꾸고 싶어요")
        .exclusions,
    ).toEqual(["grain"]);
  });
  it("surfaces requests the available catalog cannot substantiate", () => {
    expect(
      parseDecisionQuestion("최저가로 저탄수 사료 추천").unhandled.length,
    ).toBeGreaterThan(0);
    expect(parseDecisionQuestion("신장병에 맞는 처방식").outsideScope).toBe(
      true,
    );
  });
  it("rejects malformed or ungrounded model proposals", () => {
    expect(
      validateQuestionProposal(
        {
          exclusions: ["chicken"],
          maxKcalDeltaPct: 5,
          citations: ["닭고기 제외"],
          unhandled: [],
        },
        "아무거나 추천",
      ),
    ).toBeNull();
    expect(
      validateQuestionProposal(
        { exclusions: ["chocolate"] },
        "닭고기 없는 사료",
      ),
    ).toBeNull();
    expect(
      validateQuestionProposal(
        {
          exclusions: ["beef"],
          maxKcalDeltaPct: 15,
          citations: ["닭고기"],
          unhandled: [],
        },
        "닭고기 없는 사료를 찾고 있어요",
      ),
    ).toBeNull();
    expect(
      validateQuestionProposal(
        {
          exclusions: ["chicken"],
          maxKcalDeltaPct: null,
          citations: ["닭고기는 빼지 않아도 돼요"],
          unhandled: [],
        },
        "닭고기는 빼지 않아도 돼요",
      ),
    ).toBeNull();
  });
  it("keeps unsupported ingredient exclusions visible in fallback interpretation", () => {
    expect(
      parseDecisionQuestion("완두콩 표기는 제외해 주세요").unhandled.join(" "),
    ).toContain("제외");
  });
  it("accepts a grounded proposal as editable conditions, never a food recommendation", () => {
    expect(
      validateQuestionProposal(
        {
          exclusions: ["chicken"],
          maxKcalDeltaPct: null,
          citations: ["닭고기 없는"],
          unhandled: [],
        },
        "닭고기 없는 사료를 찾고 있어요",
      )?.exclusions,
    ).toEqual(["chicken"]);
  });
});

it("keeps a mixed physical-attribute request unresolved until the owner explicitly omits it", () => {
  const question = "열량 차이 10% 이내이고 작은 알갱이 사료를 추천해 주세요";
  const interpretation = parseDecisionQuestion(question);
  const food = {
    ...SAMPLE_FOODS[0]!,
    kcal_per_kg: 4000,
    nutrient_sources: { kcal_per_kg: "manufacturer" as const },
  };
  const catalog = {
    foods: [food],
    ingredientEvidenceByFoodId: {},
    evidenceByFoodId: new Map([
      [
        food.id,
        [
          {
            nutrient_key: "kcal_per_kg" as const,
            value: 4000,
            excerpt: "4000 kcal/kg",
            captured_at: "2026-08-08",
            source: {
              url: "https://manufacturer.test/recipe",
              capture_method: "fetch",
            },
          },
        ],
      ],
    ]),
  };
  const request = {
    ...DEFAULT_DECISION_REQUEST,
    question,
    manualCurrentName: "Current",
    manualKcal: 4000,
    adultNonPrescription: true,
    maxKcalDeltaPct: interpretation.maxKcalDeltaPct,
    unresolvedRequirements: interpretation.unhandled,
  };
  const report = buildFoodDecision(catalog, request);
  expect(report.eligible).toHaveLength(0);
  expect(report.unresolved).toHaveLength(1);
  expect(report.unresolved[0]!.questions.join(" ")).toContain("알갱이");
  const omitted = buildFoodDecision(catalog, {
    ...request,
    unresolvedRequirements: [],
    ignoredRequirements: interpretation.unhandled,
  });
  expect(omitted.eligible).toHaveLength(1);
});
