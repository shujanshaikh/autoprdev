import { describe, expect, it } from "vitest";

import { formatCodexContextLimit, formatCodexModelLabel, getCodexReasoningEfforts, selectCodexModel } from "./codexModels";

describe("mobile Codex model metadata", () => {
  it.each([
    ["gpt-6-sol", "GPT-6-Sol", true],
    ["gpt-6-astra", "GPT-6-Astra", true],
    ["gpt-6-luna", "GPT-6-Luna", false],
  ] as const)("recognizes %s reasoning capabilities", (modelId, label, ultra) => {
    expect(formatCodexModelLabel(modelId)).toBe(label);
    expect(getCodexReasoningEfforts(modelId)).toEqual([
      "low", "medium", "high", "xhigh", "max", ...(ultra ? ["ultra"] : []),
    ]);
  });

  it("prefers Sol when available and preserves explicit selections", () => {
    expect(selectCodexModel(["gpt-5.6-sol", "gpt-6-sol"])).toBe("gpt-6-sol");
    expect(selectCodexModel(["gpt-5.6-sol", "gpt-6-sol"], "gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(selectCodexModel(["gpt-6-luna"])).toBe("gpt-6-luna");
  });

  it.each(["gpt-6-sol", "gpt-6-astra", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])(
    "shows the ChatGPT catalog context for %s",
    (modelId) => {
      expect(formatCodexContextLimit(modelId)).toBe("272K context");
    },
  );
});
