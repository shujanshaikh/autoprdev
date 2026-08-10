import { describe, expect, it } from "vitest";

import {
  CODEX_MODELS,
  addCodexUsageCosts,
  calculateCodexUsageCost,
  formatCodexModelLabel,
  getCodexContextLimit,
  getCodexModelOptions,
  getCodexReasoningEfforts,
  isCodexModelId,
  normalizeCodexModelList,
  selectCodexModel,
} from "./codex-models";

describe("Codex model cost helpers", () => {
  it("matches the current user-selectable Codex model catalog", () => {
    expect(CODEX_MODELS.map(({ id, label, contextLimit }) => ({ id, label, contextLimit }))).toEqual([
      { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", contextLimit: 1_050_000 },
      { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", contextLimit: 1_050_000 },
      { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", contextLimit: 1_050_000 },
      { id: "gpt-5.5", label: "GPT-5.5", contextLimit: 272_000 },
      { id: "gpt-5.4", label: "GPT-5.4", contextLimit: 272_000 },
      { id: "gpt-5.4-mini", label: "GPT-5.4-Mini", contextLimit: 272_000 },
      { id: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark", contextLimit: 128_000 },
    ]);
  });

  it("matches Codex reasoning support for every model family", () => {
    expect(getCodexReasoningEfforts("gpt-5.6-sol")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(getCodexReasoningEfforts("gpt-5.6-terra")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(getCodexReasoningEfforts("gpt-5.6-luna")).toEqual(["low", "medium", "high", "xhigh", "max"]);

    for (const modelId of ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"]) {
      expect(getCodexReasoningEfforts(modelId)).toEqual(["low", "medium", "high", "xhigh"]);
    }

    expect(getCodexReasoningEfforts("gpt-future-account-model")).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("uses a conservative context limit for dynamically discovered models", () => {
    expect(getCodexContextLimit("gpt-5.6-sol")).toBe(1_050_000);
    expect(getCodexContextLimit("gpt-account-only")).toBe(128_000);
  });

  it("formats the exact Codex display names", () => {
    expect(formatCodexModelLabel("gpt-5.6-sol")).toBe("GPT-5.6-Sol");
    expect(formatCodexModelLabel("gpt-5.4-mini")).toBe("GPT-5.4-Mini");
    expect(formatCodexModelLabel("gpt-5.3-codex-spark")).toBe("GPT-5.3-Codex-Spark");
  });

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
    expect(normalizeCodexModelList([" gpt-a ", "", "codex-auto-review", "gpt-b", "gpt-a"])).toEqual([
      "gpt-a",
      "gpt-b",
    ]);
  });

  it("selects from discovered account models without assuming the preferred model exists", () => {
    expect(selectCodexModel(["gpt-a", "gpt-5.6-sol", "gpt-b"])).toBe("gpt-5.6-sol");
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
