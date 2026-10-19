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

function comparisonReport() {
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
        2: {
          excerpt: "Salmon",
          capturedAt: "2026-08-08",
          url: "https://manufacturer.test/recipe",
        },
      },
    },
    {
      ...DEFAULT_DECISION_REQUEST,
      adultNonPrescription: true,
      manualCurrentName: "Current",
      maxKcalDeltaPct: null,
      exclusions: ["grain"],
    },
  );
  const fact = (
    key: "protein_pct" | "fat_pct",
    value: number,
    bound: "minimum" | "maximum" | "unspecified" = "minimum",
  ) => ({
    key,
    value,
    bound,
    proof: {
      nutrient_key: key,
      value,
      excerpt: `${value}%`,
      captured_at: "2026-08-08",
      source: {
        url: "https://manufacturer.test/recipe",
        capture_method: "fetch",
      },
    },
  });
  report.baseline.labelFacts = [fact("protein_pct", 34), fact("fat_pct", 18)];
  report.eligible[0]!.labelFacts = [
    fact("protein_pct", 40),
    fact("fat_pct", 14, "maximum"),
  ];
  return { report, fact };
}
function comparisonMarkup(
  report: ReturnType<typeof comparisonReport>["report"],
) {
  return renderToStaticMarkup(
    <DecisionReport
      report={report}
      historical={false}
      onSelect={() => {}}
      onToleranceChange={() => {}}
    />,
  );
}
describe("visual label comparison", () => {
  it("names the higher and lower printed values while preserving minimum and maximum bounds", () => {
    const { report } = comparisonReport();
    const html = comparisonMarkup(report);
    expect(html).toContain("후보 표기값 높음");
    expect(html).toContain("후보 표기값 낮음");
    expect(html).toContain("40% 이상");
    expect(html).toContain("14% 이하");
    expect(html).toContain("모든 막대는 0–100% 같은 축");
    expect(html).toContain("실제 함량");
    expect(html).not.toContain("더 건강");
  });
  it("distinguishes an equal printed value from missing evidence, rather than drawing missing values as zero", () => {
    const { report, fact } = comparisonReport();
    report.eligible[0]!.labelFacts = [fact("protein_pct", 34, "unspecified")];
    const html = comparisonMarkup(report);
    expect(html).toContain("표기값 같음");
    expect(html).toContain("근거 확인 필요");
    expect(html).toContain("34% (경계 미확인)");
    expect(html).not.toContain("0% 이하");
    expect(html).not.toContain("0% 이상");
    expect(html).not.toContain("후보 표기값 낮음");
  });
});
