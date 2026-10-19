import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdequacyEvidence } from "./adequacy-evidence";
import { projectAdequacy } from "@/lib/adequacy-evidence";
import {
  buildFoodDecision,
  DEFAULT_DECISION_REQUEST,
  decisionSnapshotSchema,
  exportDecisionBrief,
} from "@/lib/food-decision";
import { SAMPLE_FOODS } from "@/lib/fixtures";

const proof = projectAdequacy({
  statement:
    "Example Cat Food is formulated to meet the nutritional levels established by the AAFCO Cat Food Nutrient Profiles for all life stages.",
  source_product_name: "Example Cat Food",
  captured_at: "2026-08-08T00:00:00Z",
  applied_by_origin: "automation",
  food_sources: { url: "https://example.test/cat" },
})!;
it("renders source, scope, capture date and unknown packaging alongside the manufacturer claim", () => {
  const html = renderToStaticMarkup(<AdequacyEvidence proofs={[proof]} />);
  for (const text of [
    "AAFCO",
    "전연령",
    "배합했다는 선언",
    proof.statement,
    proof.url,
    "2026-08-08",
    "현재 포장",
    "앱이 모든 영양소를 검증하거나 인증한 결과는 아닙니다",
  ])
    expect(html).toContain(text);
});
it("keeps missing declarations distinct from non-compliance", () => {
  expect(renderToStaticMarkup(<AdequacyEvidence />)).toContain(
    "영양기준에 미달한다는 뜻은 아닙니다",
  );
});
describe("decision adequacy snapshots", () => {
  it("retains the old capture when the live catalog changes, and exports the quote", () => {
    const proofs = [proof];
    const report = buildFoodDecision(
      {
        foods: [
          {
            ...SAMPLE_FOODS[0]!,
            id: 2,
            ingredients: [{ name: "Salmon", position: 1 }],
          },
        ],
        evidenceByFoodId: new Map(),
        ingredientEvidenceByFoodId: {
          2: { excerpt: "Salmon", capturedAt: "2026-08-08", url: proof.url },
        },
        adequacyByFoodId: { 2: proofs },
      },
      {
        ...DEFAULT_DECISION_REQUEST,
        adultNonPrescription: true,
        manualCurrentName: "Existing",
        maxKcalDeltaPct: null,
        exclusions: ["grain"],
      },
    );
    expect(report.eligible).toHaveLength(1);
    const snapshot = decisionSnapshotSchema.parse({
      version: 1,
      report,
      selectedFoodId: 2,
      reason: "Check package",
    });
    proofs.length = 0;
    expect(snapshot.report.eligible[0]!.adequacy).toEqual([proof]);
    const brief = exportDecisionBrief(snapshot);
    expect(brief).toContain(proof.statement);
    expect(brief).toContain(proof.url);
    expect(brief).toContain("2026-08-08");
    const legacy = JSON.parse(JSON.stringify(snapshot));
    delete legacy.report.eligible[0].adequacy;
    delete legacy.report.baseline.adequacy;
    expect(
      decisionSnapshotSchema.parse(legacy).report.eligible[0]!.adequacy,
    ).toEqual([]);
  });
});
