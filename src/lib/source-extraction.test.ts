import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractCapturedSources,
  parseModelOutput,
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

  it("drops a leading-decimal value parsed from label punctuation", () => {
    const result = validateExtractedEvidence(
      [
        {
          excerpt: "Crude protein min.30%",
          nutrientKey: "protein_pct",
          sourceId: 11,
          value: 0.3,
        },
      ],
      [
        {
          capturedText: "Crude protein min.30%",
          id: 11,
          kind: "manufacturer",
        },
      ],
    );

    expect(result).toEqual([]);
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

  // 유럽 라벨은 소수점을 쉼표로 쓴다("Crude Fibre 2,5 %"). 쉼표를 천 단위로만 읽던
  // 동안 이 구절들은 전부 거절됐고, 그 거절이 "이미지 라벨이라 불가능"으로 잘못
  // 기록됐다. 반대로 쉼표를 지우면 2,5가 25가 되므로, 두 방향 다 고정한다.
  // kcal 쪽을 fiber로 쓰면 합계 100 초과 error 에 먼저 걸려, 쉼표 해석과 무관하게
  // 빈 배열이 나오고 검사가 공허해진다. 키를 사례마다 맞춘다.
  it.each([
    ["Crude Fibre 2,5 %", 2.5, "fiber_pct" as const, true],
    ["Crude Fibre 2,5 %", 25, "fiber_pct" as const, false],
    ["Rohasche 7,50 %", 7.5, "ash_pct" as const, true],
    ["Metabolizable energy 1,500 kcal/kg", 1500, "kcal_per_kg" as const, true],
    ["Metabolizable energy 1,500 kcal/kg", 1.5, "kcal_per_kg" as const, false],
  ])("소수점 쉼표: %s = %s → %s", (excerpt, value, nutrientKey, accepted) => {
    const evidence = { excerpt, nutrientKey, sourceId: 11, value };

    const result = validateExtractedEvidence(
      [evidence],
      [{ capturedText: excerpt, id: 11, kind: "manufacturer" }],
    );

    expect(result).toEqual(accepted ? [evidence] : []);
  });

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

describe("parseModelOutput", () => {
  // 모델이 JSON 앞뒤에 한두 문장을 붙이면 예전 파서는 통째로 실패했고 그 사료는
  // 502로 버려졌다. 브랜드 스윕에서 7건이 이렇게 사라졌다.
  it("JSON 앞뒤에 산문이 붙어도 객체를 뽑아낸다", () => {
    const payload = JSON.stringify({
      nutrients: {
        protein_pct: { excerpt: "Crude protein 38 %", sourceId: 1, value: 38 },
      },
    });

    const parsed = parseModelOutput(
      `조사 결과입니다:\n${payload}\n확인 바랍니다.`,
    );

    expect(parsed?.nutrients.protein_pct?.value).toBe(38);
  });

  it("괄호 구간을 잘라내도 형태가 틀리면 여전히 거절한다", () => {
    expect(parseModelOutput('설명 { "nutrients": 42 } 끝')).toBeNull();
  });
});
