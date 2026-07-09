import { describe, expect, it } from "vitest";

import {
  addCodexUsageCosts,
  calculateCodexUsageCost,
  getCodexModelOptions,
  isCodexModelId,
  normalizeCodexModelList,
  selectCodexModel,
} from "./codex-models";

describe("Codex model cost helpers", () => {
  it("charges uncached input, cached input, and output at their own rates", () => {
    const cost = calculateCodexUsageCost("gpt-5.5", {
      inputTokens: 1_000,
      outputTokens: 200,
      cachedInputTokens: 400,
      cacheWriteTokens: 50,
    });

    expect(cost.input).toBeCloseTo(0.003);
    expect(cost.cacheRead).toBeCloseTo(0.0002);
    expect(cost.output).toBeCloseTo(0.006);
    expect(cost.cacheWrite).toBe(0);
    expect(cost.total).toBeCloseTo(0.0092);
  });

  it("does not let cached input exceed total input", () => {
    const cost = calculateCodexUsageCost("gpt-5.5", {
      inputTokens: 100,
      outputTokens: 0,
      cachedInputTokens: 250,
      cacheWriteTokens: 0,
    });

    expect(cost.input).toBe(0);
    expect(cost.cacheRead).toBeCloseTo(0.00005);
    expect(cost.total).toBeCloseTo(0.00005);
  });

  it("adds usage cost breakdowns", () => {
    expect(
      addCodexUsageCosts(
        { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
        { input: 0.5, output: 1, cacheRead: 1.5, cacheWrite: 2, total: 5 },
      ),
    ).toEqual({
      input: 1.5,
      output: 3,
      cacheRead: 4.5,
      cacheWrite: 6,
      total: 15,
    });
  });

  it("accepts discovered ChatGPT model slugs instead of only static metadata ids", () => {
    expect(isCodexModelId("gpt-account-only")).toBe(true);
    expect(isCodexModelId("  gpt-account-only  ")).toBe(true);
    expect(isCodexModelId("")).toBe(false);
  });

  it("normalizes model lists returned by discovery", () => {
    expect(normalizeCodexModelList([" gpt-a ", "", "gpt-b", "gpt-a"])).toEqual(["gpt-a", "gpt-b"]);
  });

  it("selects from discovered account models without assuming the preferred model exists", () => {
    expect(selectCodexModel(["gpt-a", "gpt-5.5", "gpt-b"])).toBe("gpt-5.5");
    expect(selectCodexModel(["gpt-a", "gpt-b"])).toBe("gpt-a");
    expect(selectCodexModel(["gpt-a", "gpt-b"], "gpt-b")).toBe("gpt-b");
    expect(selectCodexModel(["gpt-a", "gpt-b"], "gpt-missing")).toBe("gpt-a");
    expect(selectCodexModel(undefined, "gpt-deep-link")).toBe("gpt-deep-link");
  });

  it("keeps the selected model available as a dropdown option", () => {
    expect(getCodexModelOptions(["gpt-a", "gpt-b"], "gpt-b")).toEqual(["gpt-a", "gpt-b"]);
    expect(getCodexModelOptions(["gpt-a", "gpt-b"], "gpt-current")).toEqual(["gpt-current", "gpt-a", "gpt-b"]);
  });
});
