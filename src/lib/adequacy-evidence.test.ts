import { describe, expect, it } from "vitest";
import { validateAdequacyCapture, projectAdequacy } from "./adequacy-evidence";

const statement =
  "Example Chicken Cat Food is formulated to meet the nutritional levels established by the AAFCO Cat Food Nutrient Profiles for all life stages.";
const draft = {
  sourceId: 11,
  statement,
  sourceProductName: "Example Chicken Cat Food",
  sourceContentHash: "abc123",
};
const source = {
  food_id: 5,
  kind: "manufacturer",
  is_current: true,
  fetch_status: "fetched",
  content_hash: "abc123",
  captured_at: "2026-08-08T00:00:00Z",
  captured_text: statement,
};

describe("adequacy source boundary", () => {
  it("accepts a single literal cat declaration without asserting current packaging or market", () => {
    expect(validateAdequacyCapture(5, draft, source)).toBe(true);
    expect(
      projectAdequacy({
        statement,
        source_product_name: draft.sourceProductName,
        captured_at: source.captured_at,
        applied_by_origin: "automation",
        food_sources: { url: "https://example.com/ca/cat" },
      }),
    ).toMatchObject({
      standard: "AAFCO",
      lifeStage: "all_life_stages",
      method: "formulation",
      salesMarket: null,
      currentPackageVerified: false,
    });
  });
  it.each([
    { food_id: 6 },
    { is_current: false },
    { kind: "kr_label" },
    { fetch_status: "failed" },
    { content_hash: "changed" },
    { captured_at: null },
    { captured_text: statement.replace("Chicken", "Turkey") },
    { captured_text: `${statement} ${statement.replace("Chicken", "Turkey")}` },
  ])(
    "refuses stale, foreign, non-literal and multi-product sources %j",
    (change) => {
      expect(validateAdequacyCapture(5, draft, { ...source, ...change })).toBe(
        false,
      );
    },
  );
  it("requires the reviewed product name inside the declaration", () => {
    expect(
      validateAdequacyCapture(
        5,
        { ...draft, sourceProductName: "Other Cat Food" },
        source,
      ),
    ).toBe(false);
  });
  it("does not project generic complete food or dog statements", () => {
    expect(
      projectAdequacy({
        statement: "Complete cat food",
        source_product_name: "Cat",
        captured_at: source.captured_at,
        applied_by_origin: "automation",
        food_sources: { url: "https://example.com" },
      }),
    ).toBeNull();
    expect(
      validateAdequacyCapture(
        5,
        {
          ...draft,
          statement: statement.replaceAll("Cat", "Dog"),
          sourceProductName: "Example Chicken Dog Food",
        },
        { ...source, captured_text: statement.replaceAll("Cat", "Dog") },
      ),
    ).toBe(false);
  });
});
