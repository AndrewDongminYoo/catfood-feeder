import { describe, expect, it } from "vitest";
import { buildFoodDecision, DEFAULT_DECISION_REQUEST } from "./food-decision";
import { SAMPLE_FOODS } from "./fixtures";
import {
  parseDecisionQuestion,
  validateQuestionProposal,
} from "./decision-question";

describe("decision question", () => {
  it.each([
    "grain-free is okay",
    "grain free is fine",
    "I don't need grain-free food",
    "not grain-free",
    "grain-free is not necessary",
    "grain-free, if possible",
    "grain-free, but it is not required",
    "그레인프리, 꼭 필요하지는 않아요",
    "grain-free? No, not necessary.",
    "Please find grain-free food? No, not necessary.",
    "Please find grain-free food? No thanks.",
    "Please find grain-free food? Never mind.",
    "그레인프리 사료를 찾아주세요? 아니요, 필요 없어요.",
    "그레인프리? 필요 없어요.",
    "그레인프리일 필요 없어요",
    "그레인 프리가 아니어도 괜찮아요",
    "그레인프리는 상관없어요",
    "그레인프리 사료는 원하지 않아요",
    "가능하면 그레인프리 사료를 찾아주세요",
    "그레인프리도 괜찮아요",
    "Is grain-free better?",
    "지금 그레인프리 사료를 먹고 있어요",
  ])(
    "does not impose a grain-free mention as a requirement: %s",
    (question) => {
      expect(parseDecisionQuestion(question).exclusions).toEqual([]);
      const quote = question.match(/grain[-\s]?free|그레인\s*프리/i)![0];
      expect(
        validateQuestionProposal(
          {
            exclusions: ["grain"],
            maxKcalDeltaPct: null,
            citations: [quote],
            unhandled: [],
          },
          question,
        ),
      ).toBeNull();
    },
  );
  it.each([
    "grain-free",
    "grain-free food please",
    "I want grain-free food",
    "I need a grain-free diet",
    "I'd like grain-free food",
    "I am looking for grain-free food",
    "Please find grain-free food",
    "Please find grain-free food?",
    "그레인프리",
    "그레인프리 사료를 찾아주세요",
    "그레인프리 사료를 찾아주세요?",
    "그레인프리 사료를 추천해주세요",
    "그레인 프리로 바꾸고 싶어요",
    "닭고기를 먹고 있어요. 그레인프리로 바꾸고 싶어요",
  ])("preserves an explicit grain-free request: %s", (question) => {
    expect(parseDecisionQuestion(question)).toMatchObject({
      exclusions: ["grain"],
      unhandled: [],
    });
    expect(
      validateQuestionProposal(
        {
          exclusions: ["grain"],
          maxKcalDeltaPct: null,
          citations: [question],
          unhandled: [],
        },
        question,
      )?.exclusions,
    ).toEqual(["grain"]);
  });
  it.each([
    "I want grain-free food and no chicken",
    "no chicken and I want grain-free food",
    "Please find grain-free food? Also no chicken.",
    "닭고기를 빼고 그레인프리 사료를 찾아주세요",
    "닭고기는 제외하고 그레인프리 사료를 추천해주세요",
    "그레인프리 사료를 찾아주세요? 닭고기도 빼주세요.",
  ])(
    "preserves a grain-free request beside another exclusion: %s",
    (question) => {
      expect(parseDecisionQuestion(question).exclusions).toEqual([
        "chicken",
        "grain",
      ]);
    },
  );
  it("does not erase a negation beside a parsed exclusion", () => {
    expect(
      parseDecisionQuestion("no chicken and not grain-free").exclusions,
    ).toEqual(["chicken"]);
  });
  it("preserves a neighboring exclusion when grain-free is optional", () => {
    expect(
      parseDecisionQuestion("no chicken and grain-free is okay").exclusions,
    ).toEqual(["chicken"]);
  });
  it.each([
    "grain-free is okay. no chicken. 열량 차이는 8% 이내",
    "그레인프리일 필요 없어요. 닭고기는 빼주세요. 열량 차이는 8% 이내",
    "닭고기는 빼고 가능하면 그레인프리 사료를 찾아주세요. 열량 차이는 8% 이내",
    "Please find grain-free food? Actually, not necessary. No chicken. 열량 차이는 8% 이내",
    "그레인프리 사료를 찾아주세요? 아니요, 꼭 필요하지는 않아요. 닭고기는 빼주세요. 열량 차이는 8% 이내",
  ])(
    "preserves other conditions beside optional grain-free wording: %s",
    (question) => {
      expect(parseDecisionQuestion(question)).toMatchObject({
        exclusions: ["chicken"],
        maxKcalDeltaPct: 8,
      });
      expect(
        validateQuestionProposal(
          {
            exclusions: ["grain"],
            maxKcalDeltaPct: null,
            citations: [question.match(/grain[-\s]?free|그레인\s*프리/i)![0]],
            unhandled: [],
          },
          question,
        ),
      ).toBeNull();
    },
  );
  it("keeps an ambiguous grain-free mention unresolved beside a supported condition", () => {
    const result = parseDecisionQuestion(
      "Is grain-free better? 열량 차이는 8% 이내",
    );
    expect(result.exclusions).toEqual([]);
    expect(result.maxKcalDeltaPct).toBe(8);
    expect(result.unhandled.length).toBeGreaterThan(0);
  });
  it("does not infer a grain exclusion from an ambiguous coordinated negation", () => {
    const result = parseDecisionQuestion("no chicken or grain-free");
    expect(result.exclusions).toEqual(["chicken"]);
    expect(result.unhandled.length).toBeGreaterThan(0);
  });
  it.each([
    ["no chicken or fish", ["chicken", "fish"]],
    ["no chicken/fish", ["chicken", "fish"]],
    ["no chicken nor fish", ["chicken", "fish"]],
    ["닭고기 또는 생선을 제외해 주세요", ["chicken", "fish"]],
    ["닭고기 혹은 생선을 제외해 주세요", ["chicken", "fish"]],
    ["no chicken & fish", ["chicken", "fish"]],
    ["닭고기랑 생선을 빼주세요", ["chicken", "fish"]],
    ["닭이랑 생선을 빼주세요", ["chicken", "fish"]],
    ["닭고기하고 생선을 빼주세요", ["chicken", "fish"]],
    ["no chicken allowed", ["chicken"]],
    ["no chicken or fish allowed", ["chicken", "fish"]],
    ["without chicken, beef and fish", ["chicken", "beef", "fish"]],
    ["no chicken and no fish", ["chicken", "fish"]],
    ["오리고기와 칠면조고기를 빼주세요", ["turkey", "duck"]],
    ["닭고기와 소고기를 빼주세요", ["chicken", "beef"]],
    ["닭고기, 생선 및 곡물을 제외해 주세요", ["chicken", "fish", "grain"]],
  ])("preserves every coordinated exclusion: %s", (question, exclusions) => {
    expect(parseDecisionQuestion(question)).toMatchObject({
      exclusions,
      unhandled: [],
    });
    expect(
      validateQuestionProposal(
        {
          exclusions,
          maxKcalDeltaPct: null,
          citations: [question],
          unhandled: [],
        },
        question,
      )?.exclusions,
    ).toEqual(exclusions);
  });
  it.each([
    "no chicken or pork",
    "without rabbit and fish",
    "닭고기와 돼지고기를 빼주세요",
    "돼지고기와 소고기를 빼주세요",
    "no chicken/pork",
    "닭고기랑 돼지고기를 빼주세요",
  ])("retains unsupported list members: %s", (question) => {
    expect(parseDecisionQuestion(question).unhandled.join(" ")).toContain(
      "제외",
    );
  });
  it.each(["no chicken ~ fish", "닭고기 내지는 생선을 빼주세요"])(
    "does not silently drop an adjacent ingredient with unknown list grammar: %s",
    (question) => {
      expect(parseDecisionQuestion(question).unhandled.join(" ")).toContain(
        "제외",
      );
    },
  );
  it.each([
    "닭고기와 소고기는 빼지 않아도 돼요",
    "닭고기와 생선은 제외하지 마세요",
    "닭고기랑 생선은 빼지 마세요",
    "not without chicken/fish",
    "not without chicken or fish",
    "no chicken or fish except fish",
    "no chicken, fish is fine",
  ])("does not impose a negated or excepted list: %s", (question) => {
    expect(parseDecisionQuestion(question).exclusions).toEqual([]);
    expect(
      validateQuestionProposal(
        {
          exclusions: ["chicken"],
          maxKcalDeltaPct: null,
          citations: [
            question.includes("no chicken") ? "no chicken" : "chicken",
          ],
          unhandled: [],
        },
        question,
      ),
    ).toBeNull();
  });
  it.each([
    ["no chicken or fish. fish is fine.", ["chicken"]],
    ["생선은 빼주세요. 생선은 괜찮아요.", []],
  ])(
    "retains contradictory permissions across sentences: %s",
    (question, exclusions) => {
      expect(parseDecisionQuestion(question).exclusions).toEqual(exclusions);
      expect(parseDecisionQuestion(question).unhandled.join(" ")).toContain(
        "제외",
      );
      expect(
        validateQuestionProposal(
          {
            exclusions: ["chicken", "fish"],
            maxKcalDeltaPct: null,
            citations: [question],
            unhandled: [],
          },
          question,
        ),
      ).toBeNull();
    },
  );
  it.each([
    "urinary diet",
    "URINARY food",
    "intestinal diet",
    "hepatic diet",
    "cardiac diet",
    "liver disease diet",
    "heart disease diet",
    "thyroid diet",
    "Liver Care",
    "heart-support",
    "hyperthyroidism",
    "유리너리 사료",
    "인테스티널 사료",
    "레날 사료",
  ])(
    "keeps clinical requests outside scope in rules and model validation: %s",
    (question) => {
      expect(parseDecisionQuestion(question).outsideScope).toBe(true);
      expect(
        validateQuestionProposal(
          {
            exclusions: [],
            maxKcalDeltaPct: null,
            citations: [],
            unhandled: [],
            outsideScope: false,
          },
          question,
        )?.outsideScope,
      ).toBe(true);
    },
  );
  it.each([{ citations: [] }, { citations: ["열량이 비슷한 사료"] }])(
    "does not let an unsupported model scope flag block an ordinary question (%j)",
    ({ citations }) => {
      const result = validateQuestionProposal(
        {
          exclusions: [],
          maxKcalDeltaPct: null,
          citations,
          unhandled: [],
          outsideScope: true,
        },
        "열량이 비슷한 사료",
      );
      expect(result).not.toBeNull();
      expect(result?.outsideScope).toBe(false);
      expect(result?.clarifications).toContain("calories");
    },
  );
  it.each([
    "현재보다 열량이 낮지 않은 사료",
    "열량이 높은 것도 상관없어요. 닭고기는 원하지 않아요",
    "열량이 높은 것도 상관없어요, 닭고기는 원하지 않아요",
    "열량이 높은 사료도 괜찮아요; 포장은 바꾸지 않아요",
    "열량 차이는 8% 이내, 높은 것도 상관없어요. 포장은 바꾸지 않아요",
    "열량이 높은 사료를 원하지 않아요",
    "칼로리가 낮지않은 사료",
    "열량이 안 낮은 사료",
    "열량이 낮은 게 아닌 사료",
    "열량이 낮지 않아도 돼요",
    "열량이 높지 않아도 돼요",
    "칼로리가 높지않아도 괜찮아요",
    "열량이 낮을 필요는 없어요",
    "닭고기 없는 사료로, 열량이 높지 않아도 돼요",
    "열량 차이 10% 이내이되 열량이 낮지 않은 사료",
  ])("does not reverse a negated lower-calorie request: %s", (question) => {
    const result = parseDecisionQuestion(question);
    expect(result.notHigherKcal).toBe(false);
    expect(result.unhandled.join(" ")).toContain("방향성 열량 조건");
    if (result.maxKcalDeltaPct === null)
      expect(result.clarifications).toContain("calories");
    const proposed = validateQuestionProposal(
      {
        exclusions: result.exclusions,
        maxKcalDeltaPct: result.maxKcalDeltaPct,
        citations: [question],
        unhandled: [],
      },
      question,
    );
    expect(proposed?.notHigherKcal).toBe(false);
    expect(proposed?.unhandled).toEqual(result.unhandled);
  });
  it.each([
    "현재보다 열량이 낮은 사료",
    "현재보다 열량이 높지 않은 사료",
    "열량이 높지 않아야 해요",
    "열량이 현재 사료를 넘지 않는 후보",
  ])("retains an affirmative ceiling request: %s", (question) => {
    expect(parseDecisionQuestion(question).notHigherKcal).toBe(true);
  });
  it("does not invert a minimum calorie reduction into a maximum difference", () => {
    const result = parseDecisionQuestion("열량이 현재보다 10% 이상 낮은 사료");
    expect(result.maxKcalDeltaPct).toBeNull();
    expect(result.unhandled.join(" ")).toContain("열량");
  });
  it.each([
    "최소한 열량 차이는 8% 나는 사료",
    "최소한 8% 이내로 열량 차이가 나는 사료",
  ])(
    "keeps a minimum prefix outside the matched calorie wording unresolved: %s",
    (question) => {
      const result = parseDecisionQuestion(question);
      expect(result.maxKcalDeltaPct).toBeNull();
      expect(result.clarifications).toContain("calories");
      expect(result.unhandled.join(" ")).toContain("방향성 열량 조건");
    },
  );
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
  it.each([0, 2.5, 8, 100])(
    "preserves an explicit %s-percent bound before the calorie term",
    (delta) => {
      const question = `현재 사료와 ${delta}% 이내로 열량 차이가 나는 사료`;
      const result = parseDecisionQuestion(question);
      expect(result.maxKcalDeltaPct).toBe(delta);
      expect(result.clarifications).not.toContain("calories");
      expect(
        validateQuestionProposal(
          {
            exclusions: [],
            maxKcalDeltaPct: delta,
            citations: [question],
            unhandled: [],
          },
          question,
        )?.maxKcalDeltaPct,
      ).toBe(delta);
    },
  );
  it("keeps an out-of-range percentage before the calorie term unresolved", () => {
    const result = parseDecisionQuestion(
      "101% 이내로 열량 차이를 제한해 주세요",
    );
    expect(result.maxKcalDeltaPct).toBeNull();
    expect(result.clarifications).toContain("calories");
    expect(result.unhandled.join(" ")).toContain("0~100%");
  });
  it.each([
    "단백질은 30% 이상이고 현재 사료와 8% 이내로 열량 차이가 나는 사료",
    "현재 사료와 8% 이내로 열량 차이가 나는 사료, 단백질은 30% 이상",
    "단백질은 8% 이상이고 열량 차이는 8% 이내로 해주세요",
    "단백질은 최소로, 열량 차이는 8% 나는 사료",
  ])(
    "does not veto a calorie bound because of another nutrient's direction: %s",
    (question) => {
      const result = parseDecisionQuestion(question);
      expect(result.maxKcalDeltaPct).toBe(8);
      expect(result.clarifications).not.toContain("calories");
      expect(result.unhandled.join(" ")).toContain("보증성분");
    },
  );
  it.each([
    "단백질 8% 이하. 열량은 비슷한 사료",
    "8% 이내의 지방을 원해요. 열량은 비슷하게요",
    "열량은 비슷하고 단백질은 8% 이하인 사료",
    "열량은 비슷하게요. 지방은 8% 이내로요",
    "8% 이상 낮은 열량의 사료",
  ])(
    "does not reuse an unrelated or directional percentage: %s",
    (question) => {
      expect(parseDecisionQuestion(question).maxKcalDeltaPct).toBeNull();
    },
  );
  it.each(["Chicken Liver Recipe", "Chicken Heart & Liver"])(
    "does not treat an ordinary organ ingredient as clinical: %s",
    (question) =>
      expect(parseDecisionQuestion(question).outsideScope).toBe(false),
  );
  it.each([
    { question: "열량은 비슷하고 닭고기 함량 20% 이내인 사료", delta: null },
    { question: "열량 차이는 8% 이내이고 닭고기 함량은 20% 이상", delta: 8 },
    { question: "열량은 비슷하고 연어가 20% 이상인 사료", delta: null },
    { question: "열량 차이는 8% 이내이고 닭고기 함량은 8% 이상", delta: 8 },
    { question: "닭고기 함량은 8% 이상이고 열량 차이는 8% 이내", delta: 8 },
    { question: "열량은 한약8% 함유 사료", delta: null },
  ])(
    "keeps an ingredient percentage distinct from the calorie bound: $question",
    ({ question, delta }) => {
      const result = parseDecisionQuestion(question);
      expect(result.maxKcalDeltaPct).toBe(delta);
      expect(result.unhandled.join(" ")).toContain("비율 조건");
    },
  );
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

it.each([
  ["열량 차이 10% 이내이고 작은 알갱이 사료를 추천해 주세요", "알갱이"],
  ["현재보다 열량이 낮지 않은 사료", "방향성 열량 조건"],
  ["no chicken ~ fish, 열량 차이는 8% 이내", "제외"],
])(
  "keeps unsupported requirements unresolved until explicitly omitted: %s",
  (question, expected) => {
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
      maxKcalDeltaPct:
        interpretation.maxKcalDeltaPct ??
        DEFAULT_DECISION_REQUEST.maxKcalDeltaPct,
      unresolvedRequirements: interpretation.unhandled,
    };
    const report = buildFoodDecision(catalog, request);
    expect(report.eligible).toHaveLength(0);
    expect(report.unresolved).toHaveLength(1);
    expect(report.unresolved[0]!.questions.join(" ")).toContain(expected);
    const omitted = buildFoodDecision(catalog, {
      ...request,
      unresolvedRequirements: [],
      ignoredRequirements: interpretation.unhandled,
    });
    expect(omitted.eligible).toHaveLength(1);
  },
);
