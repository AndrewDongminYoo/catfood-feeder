import { describe, expect, it } from "vitest";
import { matchExcerptValue } from "./excerpt-match";

describe("matchExcerptValue", () => {
  it("marks a token whose trailing zeros differ from the stored value", () => {
    expect(matchExcerptValue("Crude Fat 14.00%", 14)).toEqual({
      before: "Crude Fat ",
      match: "14.00",
      after: "%",
    });
  });

  it("reads a decimal comma as a decimal point rather than deleting it", () => {
    expect(matchExcerptValue("조섬유 2,5 %", 2.5)).toEqual({
      before: "조섬유 ",
      match: "2,5",
      after: " %",
    });
    expect(matchExcerptValue("조섬유 2,5 %", 25)).toBeNull();
  });

  it("selects the token matching the value when the excerpt carries several", () => {
    expect(
      matchExcerptValue(
        "Metabolizable Energy (ME) 3,200 kcal/kg; 320 kcal/cup",
        3200,
      ),
    ).toEqual({
      before: "Metabolizable Energy (ME) ",
      match: "3,200",
      after: " kcal/kg; 320 kcal/cup",
    });
  });

  it("returns null when no token equals the value", () => {
    expect(matchExcerptValue("Crude Protein 36%", 30)).toBeNull();
  });
});
