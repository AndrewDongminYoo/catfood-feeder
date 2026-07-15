import { describe, expect, it } from "vitest";
import {
  hashSourceText,
  isEvidenceExcerpt,
  normalizeSourceText,
} from "./source-collection";

describe("source collection text", () => {
  it("matches an evidence excerpt across case and whitespace differences", () => {
    const source = "Crude Protein\n(min.)  37 %";
    const excerpt = "crude protein (min.) 37 %";

    expect(isEvidenceExcerpt(source, excerpt)).toBe(true);
  });

  it("rejects an excerpt absent from the captured text", () => {
    expect(isEvidenceExcerpt("Crude fat 18%", "Crude protein 37%")).toBe(false);
  });

  it("hashes equivalent normalized text identically", () => {
    expect(hashSourceText("Protein  37%\n")).toBe(
      hashSourceText("protein 37%"),
    );
  });

  it("normalizes Unicode and collapses whitespace", () => {
    expect(normalizeSourceText("Ｐｒｏｔｅｉｎ\t37%\n")).toBe("protein 37%");
  });
});
