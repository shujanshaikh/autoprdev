/**
 * Limits exposed by the ChatGPT-backed Codex model catalog.
 *
 * These are intentionally separate from the public OpenAI API model limits:
 * AutoPR authenticates with ChatGPT and calls the Codex backend, whose catalog
 * currently caps GPT-5.6 Sol, Terra, and Luna at a 272k context window.
 */
export const CHATGPT_CODEX_MODEL_LIMITS = {
  "gpt-5.6-sol": {
    contextWindowTokens: 272_000,
    maxOutputTokens: 128_000,
  },
  "gpt-5.6-terra": {
    contextWindowTokens: 272_000,
    maxOutputTokens: 128_000,
  },
  "gpt-5.6-luna": {
    contextWindowTokens: 272_000,
    maxOutputTokens: 128_000,
  },
} as const;

export type ChatGPTCodexModelWithKnownLimits = keyof typeof CHATGPT_CODEX_MODEL_LIMITS;

export function getChatGPTCodexModelLimits(modelId: string | undefined) {
  if (!modelId || !(modelId in CHATGPT_CODEX_MODEL_LIMITS)) {
    return undefined;
  }

  return CHATGPT_CODEX_MODEL_LIMITS[modelId as ChatGPTCodexModelWithKnownLimits];
}
