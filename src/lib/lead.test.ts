import { describe, expect, it } from "vitest";
import { getLeadClassification } from "./lead";

describe("getLeadClassification", () => {
  it.each([[0, "C"], [4, "C"], [5, "B"], [7, "B"], [8, "A"], [10, "A"]] as const)("classifies score %s as %s", (score, expected) => {
    expect(getLeadClassification(score)).toBe(expected);
  });

  it("rejects scores outside the valid integer range", () => {
    expect(() => getLeadClassification(-1)).toThrow(RangeError);
    expect(() => getLeadClassification(10.5)).toThrow(RangeError);
    expect(() => getLeadClassification(11)).toThrow(RangeError);
  });
});
