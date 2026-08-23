import { describe, expect, it } from "vitest";

import { CHATGPT_CODEX_MODEL_LIMITS, getChatGPTCodexModelLimits } from "../../src/core/codex-model-limits";

describe("ChatGPT Codex model limits", () => {
  it("uses the ChatGPT catalog limits instead of public API limits", () => {
    expect(CHATGPT_CODEX_MODEL_LIMITS).toEqual({
      "gpt-5.6-sol": { contextWindowTokens: 272_000, maxOutputTokens: 128_000 },
      "gpt-5.6-terra": { contextWindowTokens: 272_000, maxOutputTokens: 128_000 },
      "gpt-5.6-luna": { contextWindowTokens: 272_000, maxOutputTokens: 128_000 },
    });
  });

  it("does not invent limits for dynamically discovered models", () => {
    expect(getChatGPTCodexModelLimits("gpt-5.6-sol")).toEqual({
      contextWindowTokens: 272_000,
      maxOutputTokens: 128_000,
    });
    expect(getChatGPTCodexModelLimits("gpt-account-only")).toBeUndefined();
    expect(getChatGPTCodexModelLimits("toString")).toBeUndefined();
    expect(getChatGPTCodexModelLimits("constructor")).toBeUndefined();
    expect(getChatGPTCodexModelLimits("__proto__")).toBeUndefined();
    expect(getChatGPTCodexModelLimits(undefined)).toBeUndefined();
  });
});
