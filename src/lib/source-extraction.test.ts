import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractCapturedSources,
  validateExtractedEvidence,
} from "./source-extraction";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("extractCapturedSources", () => {
  it("retries once when the first Anthropic request times out", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({ nutrients: {} }),
                type: "text",
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractCapturedSources([]);

    expect(result.kind).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once when the first Anthropic response body times out", async () => {
    const timedOutBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new DOMException("timed out", "TimeoutError"));
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(timedOutBody, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({ nutrients: {} }),
                type: "text",
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractCapturedSources([]);

    expect(result.kind).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("validateExtractedEvidence", () => {
  it("drops a nutrient whose value is not present in its evidence excerpt", () => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt: "Crude protein 37%",
          nutrientKey: "protein_pct",
          sourceId: 11,
          value: 99,
        },
      ],
      [
        {
          capturedText: "Crude protein 37%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
  });

  it("drops a nutrient whose evidence contains a Unicode fraction", () => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt: "Crude protein ½%",
          nutrientKey: "protein_pct",
          sourceId: 11,
          value: 1,
        },
      ],
      [
        {
          capturedText: "Crude protein ½%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
  });

  it("drops a nutrient whose excerpt contains multiple numeric claims", () => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt: "Crude protein 37%, crude fat 99%",
          nutrientKey: "protein_pct",
          sourceId: 11,
          value: 99,
        },
      ],
      [
        {
          capturedText: "Crude protein 37%, crude fat 99%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
  });

  it("accepts a leading-decimal value from an unambiguous excerpt", () => {
    const evidence = {
      excerpt: "Crude protein .7%",
      nutrientKey: "protein_pct" as const,
      sourceId: 11,
      value: 0.7,
    };

    const result = validateExtractedEvidence(
      [evidence],
      [
        {
          capturedText: "Crude protein .7%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([evidence]);
  });

  it.each(["Calcium 0.0000001%", "Calcium .0000001%"])(
    "accepts a small decimal whose JavaScript value uses exponent notation: %s",
    (excerpt) => {
      const evidence = {
        excerpt,
        nutrientKey: "calcium_pct" as const,
        sourceId: 11,
        value: 0.0000001,
      };

      const result = validateExtractedEvidence(
        [evidence],
        [
          {
            capturedText: excerpt,
            id: 11,
            kind: "manufacturer",
          },
        ],
      );

      expect(result).toEqual([evidence]);
    },
  );

  it.each([
    ["Calcium 1,2%", 12],
    ["Calcium 1,,2%", 12],
    ["Calcium 1,%", 1],
    ["Calcium ,1%", 1],
    ["Calcium 1,,%", 1],
    ["Calcium ..1%", 0.1],
  ])("drops a nutrient with invalid comma grouping: %s", (excerpt, value) => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt,
          nutrientKey: "calcium_pct",
          sourceId: 11,
          value,
        },
      ],
      [
        {
          capturedText: excerpt,
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
  });

  it("drops a numeric token outside the JavaScript safe-integer range", () => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt: "Calcium 9007199254740993%",
          nutrientKey: "calcium_pct",
          sourceId: 11,
          value: 9007199254740992,
        },
      ],
      [
        {
          capturedText: "Calcium 9007199254740993%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
  });

  it.each([
    ["Calcium 0.99999999999999999%", 1],
    ["Calcium 9007199254740991.4%", 9007199254740991],
  ])(
    "drops a decimal literal that rounds to the submitted value: %s",
    (excerpt, value) => {
      const result = validateExtractedEvidence(
        [
          {
            excerpt,
            nutrientKey: "calcium_pct",
            sourceId: 11,
            value,
          },
        ],
        [
          {
            capturedText: excerpt,
            id: 11,
            kind: "manufacturer",
          },
        ],
      );

      expect(result).toEqual([]);
    },
  );

  it("accepts a correctly grouped thousands value", () => {
    const evidence = {
      excerpt: "Metabolizable energy 3,850 kcal/kg",
      nutrientKey: "kcal_per_kg" as const,
      sourceId: 11,
      value: 3850,
    };

    const result = validateExtractedEvidence(
      [evidence],
      [
        {
          capturedText: evidence.excerpt,
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([evidence]);
  });

  it("drops an evidence-backed nutrient that violates catalog domain rules", () => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt: "Crude protein 101%",
          nutrientKey: "protein_pct",
          sourceId: 11,
          value: 101,
        },
      ],
      [
        {
          capturedText: "Crude protein 101%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
  });

  it("drops a nutrient whose excerpt is absent from its cited source", () => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt: "Crude protein 40%",
          nutrientKey: "protein_pct",
          sourceId: 11,
          value: 37,
        },
      ],
      [
        {
          capturedText: "Crude protein 37%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
  });

  it("drops a nutrient that cites a source outside the supplied source set", () => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt: "Crude protein 37%",
          nutrientKey: "protein_pct",
          sourceId: 12,
          value: 37,
        },
      ],
      [
        {
          capturedText: "Crude protein 37%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
  });

  it("drops a negative nutrient before it reaches the evidence RPC", () => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt: "Crude protein -1%",
          nutrientKey: "protein_pct",
          sourceId: 11,
          value: -1,
        },
      ],
      [
        {
          capturedText: "Crude protein -1%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
  });
});
