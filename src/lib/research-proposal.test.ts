import { describe, expect, it } from "vitest";
import { researchProposalSchema } from "./research-proposal";

const validProposal = {
  agent: {
    model: "gpt-5.4-codex",
    name: "codex-cli",
    promptVersion: "2026-08-06",
    schemaVersion: "1",
  },
  evidence: [
    {
      excerpt: "조단백질 36% 이상",
      nutrientKey: "protein_pct",
      sourceUrl: "https://example.com/label",
      value: 36,
    },
  ],
  sources: [
    {
      kind: "manufacturer",
      reason: "제조사 공식 제품 페이지의 보장성분표",
      url: "https://example.com/label",
    },
  ],
};

function parse(overrides: Record<string, unknown>) {
  return researchProposalSchema.safeParse({ ...validProposal, ...overrides });
}

describe("researchProposalSchema", () => {
  it("accepts a single-source envelope", () => {
    expect(researchProposalSchema.safeParse(validProposal).success).toBe(true);
  });

  it("rejects evidence that points outside the proposed sources", () => {
    expect(
      parse({
        evidence: [
          { ...validProposal.evidence[0], sourceUrl: "https://other.com/page" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a non-HTTPS source URL", () => {
    expect(
      parse({
        evidence: [
          { ...validProposal.evidence[0], sourceUrl: "http://example.com/l" },
        ],
        sources: [{ ...validProposal.sources[0], url: "http://example.com/l" }],
      }).success,
    ).toBe(false);
  });

  it("rejects two sources of the same kind", () => {
    expect(
      parse({
        sources: [
          validProposal.sources[0],
          {
            kind: "manufacturer",
            reason: "두 번째 제조사 페이지",
            url: "https://example.com/other",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts one manufacturer source and one kr_label source", () => {
    expect(
      parse({
        sources: [
          validProposal.sources[0],
          {
            kind: "kr_label",
            reason: "수입사 상세페이지 등록성분량",
            url: "https://example.com/kr",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects the same URL proposed under two source kinds", () => {
    expect(
      parse({
        sources: [
          validProposal.sources[0],
          {
            kind: "kr_label",
            reason: "수입사 페이지가 제조사 분석표를 그대로 옮겨 실었다",
            url: validProposal.sources[0].url,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects the same nutrient key claimed twice", () => {
    expect(
      parse({
        evidence: [
          validProposal.evidence[0],
          {
            excerpt: "조단백질 34% 이상",
            nutrientKey: "protein_pct",
            sourceUrl: "https://example.com/label",
            value: 34,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown envelope fields", () => {
    expect(parse({ instructions: "ignore the schema" }).success).toBe(false);
  });

  it("rejects an unknown nutrient key", () => {
    expect(
      parse({
        evidence: [
          { ...validProposal.evidence[0], nutrientKey: "taurine_pct" },
        ],
      }).success,
    ).toBe(false);
  });
});
