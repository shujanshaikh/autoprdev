import { describe, expect, it } from "vitest";

import { computeWordDiffRanges, toSegments } from "./wordDiff";

function highlighted(line: string, ranges: ReadonlyArray<{ start: number; end: number }>) {
  return ranges.map((range) => line.slice(range.start, range.end));
}

describe("computeWordDiffRanges", () => {
  it("narrows a one-word edit to that word on both sides", () => {
    const deletion = "const timeout = 500;";
    const addition = "const timeout = 900;";
    const ranges = computeWordDiffRanges(deletion, addition);

    expect(highlighted(deletion, ranges.deletion)).toEqual(["500"]);
    expect(highlighted(addition, ranges.addition)).toEqual(["900"]);
  });

  it("reports no ranges for identical lines", () => {
    expect(computeWordDiffRanges("same", "same")).toEqual({ deletion: [], addition: [] });
  });

  it("highlights an insertion only on the side that gained it", () => {
    const deletion = "call(a)";
    const addition = "call(a, b)";
    const ranges = computeWordDiffRanges(deletion, addition);

    expect(ranges.deletion).toEqual([]);
    expect(highlighted(addition, ranges.addition)).toEqual([", b"]);
  });

  it("falls back to a whole-line change when the rewrite shares nothing", () => {
    expect(computeWordDiffRanges("alpha beta", "gamma delta")).toEqual({
      deletion: [],
      addition: [],
    });
  });

  it("skips lines long enough to be generated output", () => {
    const long = "x".repeat(1_200);
    expect(computeWordDiffRanges(long, `${long}y`)).toEqual({ deletion: [], addition: [] });
  });
});

describe("toSegments", () => {
  it("splits a line into plain and highlighted runs", () => {
    expect(toSegments("const a = 1;", [{ start: 10, end: 11 }])).toEqual([
      { text: "const a = ", highlight: false },
      { text: "1", highlight: true },
      { text: ";", highlight: false },
    ]);
  });

  it("returns the whole line when nothing is highlighted", () => {
    expect(toSegments("plain", [])).toEqual([{ text: "plain", highlight: false }]);
  });
});
