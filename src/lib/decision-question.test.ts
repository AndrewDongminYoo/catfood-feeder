import { describe, expect, it } from "vitest";
import {
  parseDecisionQuestion,
  validateQuestionProposal,
} from "./decision-question";

describe("decision question", () => {
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
