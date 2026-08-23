import { describe, expect, it } from "vitest";
import {
  deriveIngredientForm,
  deriveIngredientSpecificity,
} from "./ingredient-form";

describe("deriveIngredientForm", () => {
  it("렌더링된 분말을 meal 로 읽는다", () => {
    expect(deriveIngredientForm("chicken meal")).toBe("meal");
    expect(deriveIngredientForm("계육분")).toBe("meal");
    expect(deriveIngredientForm("닭고기분말")).toBe("meal");
  });

  it("건조 원료를 dried 로 읽는다", () => {
    expect(deriveIngredientForm("dehydrated chicken")).toBe("dried");
    expect(deriveIngredientForm("dried egg product")).toBe("dried");
    expect(deriveIngredientForm("말린 닭고기")).toBe("dried");
  });

  it("생물 표기를 fresh 로 읽는다", () => {
    expect(deriveIngredientForm("fresh chicken")).toBe("fresh");
    expect(deriveIngredientForm("deboned salmon")).toBe("fresh");
    expect(deriveIngredientForm("raw whole herring")).toBe("fresh");
    expect(deriveIngredientForm("뼈바른 생닭고기")).toBe("fresh");
  });

  it("부산물을 by_product 로 읽는다", () => {
    expect(deriveIngredientForm("chicken by-product meal")).toBe("by_product");
    expect(deriveIngredientForm("가금 부산물")).toBe("by_product");
  });

  it("형태를 알 수 없으면 unspecified 를 돌려준다", () => {
    expect(deriveIngredientForm("peas")).toBe("unspecified");
    expect(deriveIngredientForm("완두")).toBe("unspecified");
    expect(deriveIngredientForm("타피오카")).toBe("unspecified");
  });

  it("by_product 가 meal 보다 우선한다", () => {
    // "by-product meal" 은 두 규칙에 모두 걸린다. 더 구체적인 쪽이 이겨야 한다.
    expect(deriveIngredientForm("poultry by-product meal")).toBe("by_product");
  });

  it("생선을 생물 표기로 오독하지 않는다", () => {
    // "생"으로 시작하지만 "생선"은 형태가 아니라 종류다.
    expect(deriveIngredientForm("생선")).toBe("unspecified");
  });

  it("공백과 대소문자에 흔들리지 않는다", () => {
    expect(deriveIngredientForm("  Chicken Meal  ")).toBe("meal");
  });
});

describe("deriveIngredientSpecificity", () => {
  it("종을 밝힌 표기를 species 로 읽는다", () => {
    expect(deriveIngredientSpecificity("chicken meal")).toBe("species");
    expect(deriveIngredientSpecificity("닭고기")).toBe("species");
    expect(deriveIngredientSpecificity("연어")).toBe("species");
  });

  it("종을 밝히지 않은 상위 범주를 category 로 읽는다", () => {
    expect(deriveIngredientSpecificity("poultry meal")).toBe("category");
    expect(deriveIngredientSpecificity("가금육")).toBe("category");
    expect(deriveIngredientSpecificity("meat and bone meal")).toBe("category");
    expect(deriveIngredientSpecificity("육류")).toBe("category");
  });

  it("종 이름이 있으면 상위 범주 단어가 같이 있어도 species 다", () => {
    expect(deriveIngredientSpecificity("chicken meat meal")).toBe("species");
  });

  it("모르는 종 이름이 붙어 있으면 category 로 단정하지 않는다", () => {
    // category 는 "만든 쪽이 종을 밝히지 않았다"는 부정 신호다. 규칙이 모르는 종
    // 이름이 조용히 그 신호로 둔갑하면 신호 자체가 못 쓰게 된다.
    expect(deriveIngredientSpecificity("fish meal")).toBe("category");
    expect(deriveIngredientSpecificity("menhaden fish meal")).toBe(
      "unspecified",
    );
  });

  it("동물성 원료가 아니면 판단하지 않는다", () => {
    expect(deriveIngredientSpecificity("peas")).toBe("unspecified");
    expect(deriveIngredientSpecificity("완두")).toBe("unspecified");
  });
});
