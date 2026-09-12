import { describe, expect, it } from "vitest";

import { normalizeVisionSliceName } from "@/lib/transcription-locator";

describe("normalizeVisionSliceName", () => {
  it("maps an attached locator filename back to its tile identifier", () => {
    expect(normalizeVisionSliceName("215-0-t01-small.jpg")).toBe("215-0-t01");
    expect(normalizeVisionSliceName("215-1-t01-small.jpg")).toBe("215-1-t01");
  });

  it("maps the absolute tile path used by the transcription script", () => {
    expect(normalizeVisionSliceName("/tmp/run/215-0-t01-small.jpg")).toBe(
      "215-0-t01",
    );
  });

  it("preserves a tile identifier returned by the model", () => {
    expect(normalizeVisionSliceName("t02")).toBe("t02");
  });
});
