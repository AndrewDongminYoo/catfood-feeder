import { describe, expect, it } from "vitest";
import {
  buildAdequacyCollection,
  type AdequacyCollectionSource,
} from "./adequacy-collection";

const source: AdequacyCollectionSource = {
  id: 42,
  food_id: 30,
  kind: "manufacturer",
  fetch_status: "fetched",
  is_current: true,
  url: "https://www.acana.com/en-CA/cats/cat-food/homestead-harvest/ns-aca-homestead-cat.html",
  captured_at: "2026-08-08T00:00:00Z",
  content_hash: "original-capture-hash",
  captured_text:
    "ACANA Homestead Harvest is formulated to meet the nutritional levels established by FEDIAF for Adult Maintenance.",
  foods: {
    id: 30,
    product_name: "아카나 캣 홈스테드 하비스트",
    published_at: "2026-08-08T00:00:00Z",
  },
};
describe("adequacy collection boundary", () => {
  it("keeps original capture provenance and never marks a draft as reviewed", () => {
    const manifest = buildAdequacyCollection([source], "2026-10-19T00:00:00Z");
    expect(manifest.declarations[0]).toMatchObject({
      foodId: 30,
      sourceId: 42,
      capturedAt: source.captured_at,
      sourceContentHash: source.content_hash,
      url: source.url,
      status: "draft",
      salesMarket: null,
      reviewRequired: {
        productIdentity: true,
        salesMarket: true,
        currentPackage: true,
      },
    });
    expect(manifest.generatedAt).not.toBe(manifest.declarations[0]!.capturedAt);
    expect(manifest.sourceCount).toBe(1);
  });
  it.each([
    { ...source, is_current: false },
    { ...source, kind: "kr_label" },
    { ...source, fetch_status: "failed" },
    { ...source, foods: { ...source.foods, published_at: null } },
    { ...source, foods: { ...source.foods, id: 99 } },
    { ...source, url: "http://127.0.0.1/private" },
  ])(
    "does not include a source outside the published manufacturer boundary",
    (invalid) => {
      const manifest = buildAdequacyCollection(
        [invalid],
        "2026-10-19T00:00:00Z",
      );
      expect(manifest.sourceCount).toBe(0);
      expect(manifest.declarations).toEqual([]);
      expect(manifest.unresolved).toEqual([]);
    },
  );
  it("keeps absent statements unresolved rather than treating absence as noncompliance", () => {
    const manifest = buildAdequacyCollection(
      [
        {
          ...source,
          captured_text: "Not recognized as an essential nutrient by AAFCO.",
        },
      ],
      "2026-10-19T00:00:00Z",
    );
    expect(manifest.declarations).toEqual([]);
    expect(manifest.unresolved[0]).toMatchObject({
      foodId: 30,
      reason: "no_recognized_declaration",
    });
  });
  it("does not attach a dog-only declaration to a cat-food record", () => {
    const manifest = buildAdequacyCollection(
      [
        {
          ...source,
          captured_text:
            "Example Dog Food is formulated to meet the nutritional levels established by AAFCO for adult dogs.",
        },
      ],
      "2026-10-19T00:00:00Z",
    );
    expect(manifest.declarations).toEqual([]);
    expect(manifest.unresolved[0]!.reason).toBe("species_mismatch");
  });
  it("quarantines captures with declarations for multiple products instead of attaching them to one food", () => {
    const captured_text =
      "Example Chicken Dry Cat Food is formulated to meet the nutritional levels established by AAFCO for Adult Maintenance. Example Salmon Canned Cat Food is formulated to meet the nutritional levels established by AAFCO for Adult Maintenance.";
    const manifest = buildAdequacyCollection(
      [{ ...source, captured_text }],
      "2026-10-19T00:00:00Z",
    );
    expect(manifest.declarations).toEqual([]);
    expect(manifest.unresolved[0]!.reason).toBe(
      "multiple_distinct_declarations",
    );
    expect(manifest.identityReview[0]!.candidates).toHaveLength(2);
  });
  it("quarantines mixed cat and dog product declarations before filtering species", () => {
    const captured_text =
      "Example Chicken Cat Food is formulated to meet the nutritional levels established by AAFCO for adult cats. Example Chicken Dog Food is formulated to meet the nutritional levels established by AAFCO for adult dogs.";
    const manifest = buildAdequacyCollection(
      [{ ...source, captured_text }],
      "2026-10-19T00:00:00Z",
    );
    expect(manifest.declarations).toEqual([]);
    expect(manifest.identityReview[0]!.candidates).toHaveLength(2);
  });
});
