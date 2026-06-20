const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export const CODEX_MODELS = [
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    contextLimit: 272_000,
    reasoningEfforts: CODEX_REASONING_EFFORTS,
    cost: {
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 0,
    },
  },
] as const;

export type CodexModelId = (typeof CODEX_MODELS)[number]["id"];

type CodexTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

export type CodexUsageCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

export function isCodexModelId(value: unknown): value is CodexModelId {
  return typeof value === "string" && CODEX_MODELS.some((model) => model.id === value);
}

function getCodexModel(value: string | undefined) {
  return CODEX_MODELS.find((model) => model.id === value);
}

export function getCodexReasoningEfforts(modelId: string | undefined): readonly CodexReasoningEffort[] {
  return getCodexModel(modelId)?.reasoningEfforts ?? CODEX_REASONING_EFFORTS;
}

export function getCodexReasoningEffortLabel(value: CodexReasoningEffort) {
  return value === "xhigh" ? "Extra high" : value.charAt(0).toUpperCase() + value.slice(1);
}

export function isCodexReasoningEffortForModel(
  modelId: string | undefined,
  value: unknown,
): value is CodexReasoningEffort {
  return typeof value === "string" && getCodexReasoningEfforts(modelId).includes(value as CodexReasoningEffort);
}

export function emptyCodexUsageCost(): CodexUsageCost {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
}

export function addCodexUsageCosts(
  total: CodexUsageCost,
  cost: CodexUsageCost,
): CodexUsageCost {
  return {
    input: total.input + cost.input,
    output: total.output + cost.output,
    cacheRead: total.cacheRead + cost.cacheRead,
    cacheWrite: total.cacheWrite + cost.cacheWrite,
    total: total.total + cost.total,
  };
}

export function calculateCodexUsageCost(
  modelId: string | undefined,
  usage: CodexTokenUsage,
): CodexUsageCost {
  const cost = getCodexModel(modelId)?.cost;
  if (!cost) {
    return emptyCodexUsageCost();
  }

  const cachedInputTokens = Math.max(0, Math.min(usage.inputTokens, usage.cachedInputTokens));
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const input = (cost.input / 1_000_000) * uncachedInputTokens;
  const output = (cost.output / 1_000_000) * usage.outputTokens;
  const cacheRead = (cost.cacheRead / 1_000_000) * cachedInputTokens;
  const cacheWrite = (cost.cacheWrite / 1_000_000) * usage.cacheWriteTokens;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

export const DEFAULT_CODEX_MODEL: CodexModelId = "gpt-5.5";
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "low";
