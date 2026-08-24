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

describe("원재료 추출", () => {
  it("배열 순서로 position 을 매기고 사라진 pct 와 type 은 버린다", () => {
    const parsed = parseModelOutput(
      JSON.stringify({
        ingredients: [
          { name: "chicken", pct: 30, type: "meat" },
          { name: " chicken meal ", pct: null, type: "meat" },
          { name: "peas", pct: null, type: "plant" },
        ],
        nutrients: {},
      }),
    );

    expect(parsed?.ingredients).toEqual([
      { name: "chicken", position: 1 },
      { name: "chicken meal", position: 2 },
      { name: "peas", position: 3 },
    ]);
  });

  const source = {
    capturedText:
      "Ingredients chicken, chicken meal, peas, pea flour, natural flavor.",
    id: 7,
    kind: "manufacturer" as const,
  };

  async function extractWith(modelOutput: unknown) {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [{ text: JSON.stringify(modelOutput), type: "text" }],
          }),
          { status: 200 },
        ),
      ),
    );
    return extractCapturedSources([source]);
  }

  it("근거 문구가 증명하는 목록만 draft 로 넘긴다", async () => {
    const result = await extractWith({
      ingredient_excerpt: "chicken, chicken meal, peas",
      ingredient_source_id: 7,
      ingredients: [
        { name: "chicken" },
        { name: "chicken meal" },
        { name: "peas" },
      ],
      nutrients: {},
    });

    expect(result.kind === "success" && result.ingredientDraft).toEqual({
      excerpt: "chicken, chicken meal, peas",
      ingredients: [
        { name: "chicken", position: 1 },
        { name: "chicken meal", position: 2 },
        { name: "peas", position: 3 },
      ],
      sourceId: 7,
    });
  });

  it("구절이 없으면 목록을 통째로 버린다", async () => {
    const result = await extractWith({
      ingredient_excerpt: null,
      ingredient_source_id: 7,
      ingredients: [{ name: "chicken" }],
      nutrients: {},
    });

    expect(result.kind === "success" && result.ingredientDraft).toBe(null);
  });

  it("캡처에 없는 구절을 버린다", async () => {
    const result = await extractWith({
      ingredient_excerpt: "salmon, potato, quinoa",
      ingredient_source_id: 7,
      ingredients: [{ name: "salmon" }],
      nutrients: {},
    });

    expect(result.kind === "success" && result.ingredientDraft).toBe(null);
  });

  it("구절이 증명하지 못하는 이름이 하나라도 있으면 목록을 버린다", async () => {
    const result = await extractWith({
      ingredient_excerpt: "chicken, chicken meal",
      ingredient_source_id: 7,
      ingredients: [{ name: "chicken" }, { name: "salmon" }],
      nutrients: {},
    });

    expect(result.kind === "success" && result.ingredientDraft).toBe(null);
  });

  it("구절 안의 순서와 어긋난 목록을 버린다", async () => {
    // 이름이 어딘가에 있기만 하면 통과시키면 뒤섞인 목록이 그대로 저장된다.
    const result = await extractWith({
      ingredient_excerpt: "chicken, chicken meal, peas",
      ingredient_source_id: 7,
      ingredients: [{ name: "peas" }, { name: "chicken meal" }],
      nutrients: {},
    });

    expect(result.kind === "success" && result.ingredientDraft).toBe(null);
  });

  it("낱말 중간에 걸린 일치를 세지 않는다", async () => {
    // "pea" 는 "peas" 안이 아니라 "pea flour" 에서 잡혀야 하고,
    // 그러면 뒤따르는 "peas" 는 찾을 수 없다.
    const result = await extractWith({
      ingredient_excerpt: "peas, pea flour",
      ingredient_source_id: 7,
      ingredients: [{ name: "pea" }, { name: "peas" }],
      nutrients: {},
    });

    expect(result.kind === "success" && result.ingredientDraft).toBe(null);
  });

  it("공급되지 않은 소스를 가리키면 버린다", async () => {
    const result = await extractWith({
      ingredient_excerpt: "chicken, chicken meal",
      ingredient_source_id: 999,
      ingredients: [{ name: "chicken" }, { name: "chicken meal" }],
      nutrients: {},
    });

    expect(result.kind === "success" && result.ingredientDraft).toBe(null);
  });
});
