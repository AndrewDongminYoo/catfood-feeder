import { describe, expect, it } from "vitest";
import { parseAdequacyArgs } from "../../scripts/collect-adequacy.mjs";

describe("adequacy collection command", () => {
  it("defaults to read-only summary mode", () => {
    expect(parseAdequacyArgs([])).toEqual({ output: null, foodIds: [] });
  });
  it("accepts an explicit review file and bounded product IDs", () => {
    expect(
      parseAdequacyArgs(["--out", "/tmp/review.json", "--food-ids", "30,141"]),
    ).toEqual({ output: "/tmp/review.json", foodIds: [30, 141] });
  });
  it.each(
    [
      ["--apply"],
      ["--out"],
      ["--food-ids", "30,30"],
      ["--food-ids", "-1"],
      ["--out", "a", "--out", "b"],
      ["unexpected"],
    ].map((args) => ({ args })),
  )("rejects invalid arguments $args", ({ args }) => {
    expect(() => parseAdequacyArgs(args)).toThrow();
  });
});
