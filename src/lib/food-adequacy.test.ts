import { describe, expect, it } from "vitest";
import { extractAdequacyDeclarations } from "./food-adequacy";

describe("manufacturer adequacy declaration extraction", () => {
  it.each([
    "Example Cat Food does not meet the AAFCO Cat Food Nutrient Profiles for adult maintenance.",
    "Animal feeding tests using AAFCO procedures do not substantiate that Example Cat Food provides complete and balanced nutrition for maintenance of adult cats.",
    "Example Cat Food is not comparable in nutritional adequacy to a product which has been substantiated using AAFCO feeding tests.",
    "Animal feeding tests using AAFCO procedures cannot substantiate that Example Cat Food provides complete and balanced nutrition for maintenance of adult cats.",
  ])(
    "does not accept a negated declaration with a positive extraction anchor: %s",
    (statement) => {
      expect(extractAdequacyDeclarations(statement)).toEqual([]);
    },
  );
  it("retains a formulation declaration and only its explicit life stage", () => {
    const statement =
      "ACANA Homestead Harvest is formulated to meet the nutritional levels established by FEDIAF for Adult Maintenance.";
    expect(extractAdequacyDeclarations(statement)).toEqual([
      expect.objectContaining({
        statement,
        standard: "FEDIAF",
        method: "formulation",
        lifeStage: "adult_maintenance",
        species: "unspecified",
        status: "draft",
        edition: null,
      }),
    ]);
  });
  it("distinguishes feeding trials from formulation", () => {
    const statement =
      "Animal feeding tests using AAFCO procedures substantiate that Example Cat Food provides complete and balanced nutrition for maintenance of adult cats.";
    expect(extractAdequacyDeclarations(statement)[0]).toMatchObject({
      statement,
      standard: "AAFCO",
      method: "feeding_trial",
      lifeStage: "adult_maintenance",
      species: "cat",
    });
  });
  it("distinguishes a product-family substantiation from a direct feeding trial", () => {
    const statement =
      "Example Cat Food provides complete and balanced nutrition for adult cats and is comparable in nutritional adequacy to a product which has been substantiated using AAFCO feeding tests.";
    expect(extractAdequacyDeclarations(statement)[0]).toMatchObject({
      standard: "AAFCO",
      method: "product_family",
      lifeStage: "adult_maintenance",
    });
  });
  it("does not turn nutrient footnotes or a standard name into adequacy claims", () => {
    expect(
      extractAdequacyDeclarations(
        "Taurine 0.2%. *Not recognized as an essential nutrient by the AAFCO Cat Food Nutrient Profiles. Read the FEDIAF guidelines.",
      ),
    ).toEqual([]);
  });
  it("does not infer FEDIAF or a substantiation method from a complete-food description", () => {
    expect(
      extractAdequacyDeclarations("Complete pet food for adult cats."),
    ).toEqual([]);
  });
  it("retains Korean declarations without guessing a feeding trial", () => {
    const statement =
      "오리젠 식스 피쉬는 전체 생애 단계를 위해 FEDIAF에서 지정한 영양 수준을 충족할 수 있도록 제조되었습니다.";
    expect(extractAdequacyDeclarations(statement)[0]).toMatchObject({
      statement,
      standard: "FEDIAF",
      method: "formulation",
      lifeStage: "all_life_stages",
      species: "unspecified",
    });
  });
  it("does not infer adult maintenance when only growth is declared", () => {
    expect(
      extractAdequacyDeclarations(
        "Example Kitten Food is formulated to meet the nutritional levels established by FEDIAF for Growth of Kittens.",
      )[0],
    ).toMatchObject({ lifeStage: "growth", species: "cat" });
  });
  it("keeps unmentioned life stage and method unknown", () => {
    expect(
      extractAdequacyDeclarations(
        "Example Cat Food meets the FEDIAF nutritional guidelines.",
      )[0],
    ).toMatchObject({ lifeStage: "unspecified", method: "unspecified" });
  });
  it("deduplicates repeated declarations while preserving different declarations for review", () => {
    const adult =
      "Example Cat Food is formulated to meet the nutritional levels established by AAFCO for Adult Maintenance.";
    const growth =
      "Example Cat Food is formulated to meet the nutritional levels established by AAFCO for Growth of Kittens.";
    expect(
      extractAdequacyDeclarations(`${adult} ${adult} ${growth}`),
    ).toHaveLength(2);
  });
  it("does not classify an explicitly denied or supplemental claim as complete", () => {
    expect(
      extractAdequacyDeclarations(
        "This is not a complete and balanced cat food. For intermittent or supplemental feeding only.",
      ),
    ).toEqual([]);
  });
  it("does not turn generic FAQs into product declarations", () => {
    expect(
      extractAdequacyDeclarations(
        "Both wet and dry food can provide complete nutrition when they're labelled as complete and balanced.",
      ),
    ).toEqual([]);
  });
  it("deduplicates the same declaration after repeated navigation headings", () => {
    const sentence =
      "Example Cat Food is formulated to meet the nutritional levels established by AAFCO for Adult Maintenance.";
    expect(
      extractAdequacyDeclarations(
        `Ingredients Nutritional Statement ${sentence} Ingredients Guaranteed Analysis Feeding Guidelines Nutritional Statement ${sentence}`,
      ),
    ).toHaveLength(1);
  });
  it("uses the last heading without cutting the declaration after multiple headings", () => {
    const statement =
      "Example Cat Food is formulated to meet the nutritional levels established by AAFCO for Adult Maintenance.";
    expect(
      extractAdequacyDeclarations(
        `Nutritional Statement AAFCO Statement ${statement}`,
      )[0]!.statement,
    ).toBe(statement);
  });
  it("keeps growth and maintenance distinct from all life stages", () => {
    expect(
      extractAdequacyDeclarations(
        "Example Cat Food is formulated to meet the nutritional levels established by the AAFCO Cat Food Nutrient Profiles for growth and maintenance.",
      )[0]!.lifeStage,
    ).toBe("growth_maintenance");
  });
});
