import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionReport } from "./decision-report";
import {
  buildFoodDecision,
  DEFAULT_DECISION_REQUEST,
} from "@/lib/food-decision";
import { SAMPLE_FOODS } from "@/lib/fixtures";

describe("decision report evidence claims", () => {
  it("does not claim an unknown ingredient exclusion was cleared", () => {
    const names = ["Salmon meal", "natural flavor"];
    const report = buildFoodDecision(
      {
        foods: [
          {
            ...SAMPLE_FOODS[0]!,
            id: 2,
            ingredients: names.map((name, index) => ({
              name,
              position: index + 1,
            })),
          },
        ],
        evidenceByFoodId: new Map(),
        ingredientEvidenceByFoodId: {
          2: {
            excerpt: names.join(", "),
            capturedAt: "2026-10-01",
            url: "https://manufacturer.test/recipe",
          },
        },
      },
      {
        ...DEFAULT_DECISION_REQUEST,
        manualCurrentName: "Current food",
        adultNonPrescription: true,
        maxKcalDeltaPct: null,
        exclusions: ["chicken"],
        preferredProteins: ["chicken"],
      },
    );
    expect(report.unresolved[0]!.conditions[0]!.status).toBe("unknown");
    expect(report.unresolved[0]!.preference.status).toBe("other");
    const html = renderToStaticMarkup(
      <DecisionReport
        report={report}
        historical={false}
        comparisonDisabled={false}
        onSelect={() => {}}
        onToleranceChange={() => {}}
      />,
    );
    expect(html).not.toContain("제외 조건에 걸리지 않아 남겼어요");
    expect(html).toContain("제외 조건은 아래에서 따로 확인해 주세요");
  });
});
