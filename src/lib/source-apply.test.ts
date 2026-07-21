import { describe, expect, it } from "vitest";
import { conflictCandidates, parseEvidenceApplyResults } from "./source-apply";

describe("parseEvidenceApplyResults", () => {
  it("parses every RPC outcome into the API contract", () => {
    const results = parseEvidenceApplyResults([
      {
        excerpt: "Protein 10%",
        nutrient_key: "protein_pct",
        source_id: 21,
        status: "applied",
        value: 10,
      },
      {
        excerpt: "Fat 12%",
        nutrient_key: "fat_pct",
        source_id: 22,
        status: "skipped",
        value: 12,
      },
      {
        excerpt: "Calcium 1.2%",
        nutrient_key: "calcium_pct",
        source_id: 23,
        status: "conflict",
        value: 1.2,
      },
    ]);

    expect(results).toEqual([
      {
        excerpt: "Protein 10%",
        nutrientKey: "protein_pct",
        sourceId: 21,
        status: "applied",
        value: 10,
      },
      {
        excerpt: "Fat 12%",
        nutrientKey: "fat_pct",
        sourceId: 22,
        status: "skipped",
        value: 12,
      },
      {
        excerpt: "Calcium 1.2%",
        nutrientKey: "calcium_pct",
        sourceId: 23,
        status: "conflict",
        value: 1.2,
      },
    ]);
  });

  it("rejects an RPC result with an unknown status", () => {
    expect(() =>
      parseEvidenceApplyResults([
        {
          excerpt: "Protein 10%",
          nutrient_key: "protein_pct",
          source_id: 21,
          status: "updated",
          value: 10,
        },
      ]),
    ).toThrow();
  });
});

describe("conflictCandidates", () => {
  it("keeps only unresolved conflict candidates", () => {
    const candidates = conflictCandidates([
      {
        excerpt: "Protein 10%",
        nutrientKey: "protein_pct",
        sourceId: 21,
        status: "applied",
        value: 10,
      },
      {
        excerpt: "Fat 12%",
        nutrientKey: "fat_pct",
        sourceId: 22,
        status: "skipped",
        value: 12,
      },
      {
        excerpt: "Calcium 1.2%",
        nutrientKey: "calcium_pct",
        sourceId: 23,
        status: "conflict",
        value: 1.2,
      },
    ]);

    expect(candidates).toEqual([
      {
        excerpt: "Calcium 1.2%",
        nutrientKey: "calcium_pct",
        sourceId: 23,
        value: 1.2,
      },
    ]);
  });
});
