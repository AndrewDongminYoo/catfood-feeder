import { describe, expect, it } from "vitest";
import { parseComparisonIds } from "./comparison-query";

describe("parseComparisonIds", () => {
  it("fixture에서 쓰는 0을 포함한 명시적 비교 id를 유지한다", () => {
    expect(parseComparisonIds("0,1")).toEqual([0, 1]);
  });

  it("빈 값, 잘못된 값, 중복값은 버리되 이후의 유효한 선택은 유지한다", () => {
    expect(parseComparisonIds(",0,0,invalid,1,2")).toEqual([0, 1]);
  });
});
