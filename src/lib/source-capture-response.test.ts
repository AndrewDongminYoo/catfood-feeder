import { describe, expect, it } from "vitest";
import {
  parseSourceReplacementResult,
  sourceCaptureResponseSchema,
  sourceCaptureTone,
} from "./source-capture-response";

describe("parseSourceReplacementResult", () => {
  it.each(["initial", "unchanged", "changed"] as const)(
    "parses the %s RPC outcome",
    (contentStatus) => {
      expect(
        parseSourceReplacementResult([
          { content_status: contentStatus, source_id: 23 },
        ]),
      ).toEqual({ contentStatus, sourceId: 23 });
    },
  );

  it("rejects an incomplete RPC result", () => {
    expect(() => parseSourceReplacementResult([])).toThrow();
  });
});

describe("sourceCaptureResponseSchema", () => {
  it.each(["initial", "unchanged", "changed"] as const)(
    "accepts the %s API outcome",
    (contentStatus) => {
      const result = sourceCaptureResponseSchema.safeParse({
        contentStatus,
        source: {
          capturedAt: "2026-07-23T12:00:00.000Z",
          capturedText: "Protein 33%",
          contentHash: "a".repeat(64),
          id: 23,
          kind: "manufacturer",
          observedAt: null,
          url: "https://example.test/product",
        },
      });

      expect(result.success).toBe(true);
    },
  );

  it("rejects an unknown content status", () => {
    const result = sourceCaptureResponseSchema.safeParse({
      contentStatus: "reviewed",
      source: {},
    });

    expect(result.success).toBe(false);
  });
});

describe("sourceCaptureTone", () => {
  it("uses a warning only for changed content", () => {
    expect(sourceCaptureTone("initial")).toBe("success");
    expect(sourceCaptureTone("unchanged")).toBe("success");
    expect(sourceCaptureTone("changed")).toBe("warning");
  });
});
