const STANDARD_CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
const MAX_CODEX_REASONING_EFFORTS = [...STANDARD_CODEX_REASONING_EFFORTS, "max"] as const;
const ULTRA_CODEX_REASONING_EFFORTS = [...MAX_CODEX_REASONING_EFFORTS, "ultra"] as const;
const HIDDEN_CODEX_MODEL_IDS = new Set(["codex-auto-review"]);

export type CodexReasoningEffort = (typeof ULTRA_CODEX_REASONING_EFFORTS)[number];
export type CodexModelId = string;

type CodexModel = {
  id: CodexModelId;
  label: string;
  contextLimit: number;
  reasoningEfforts: readonly CodexReasoningEffort[];
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export const PREFERRED_CODEX_MODEL: CodexModelId = "gpt-5.6-sol";

export const CODEX_MODELS: readonly CodexModel[] = [
  {
    id: PREFERRED_CODEX_MODEL,
    label: "GPT-5.6-Sol",
    contextLimit: 372_000,
    reasoningEfforts: ULTRA_CODEX_REASONING_EFFORTS,
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6-Terra",
    contextLimit: 372_000,
    reasoningEfforts: ULTRA_CODEX_REASONING_EFFORTS,
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6-Luna",
    contextLimit: 372_000,
    reasoningEfforts: MAX_CODEX_REASONING_EFFORTS,
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    contextLimit: 272_000,
    reasoningEfforts: STANDARD_CODEX_REASONING_EFFORTS,
    cost: {
      input: 5,
      output: 30,
      cacheRead: 0.5,
      cacheWrite: 0,
    },
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    contextLimit: 272_000,
    reasoningEfforts: STANDARD_CODEX_REASONING_EFFORTS,
    cost: {
      input: 2.5,
      output: 15,
      cacheRead: 0.25,
      cacheWrite: 0,
    },
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4-Mini",
    contextLimit: 272_000,
    reasoningEfforts: STANDARD_CODEX_REASONING_EFFORTS,
    cost: {
      input: 0.75,
      output: 4.5,
      cacheRead: 0.075,
      cacheWrite: 0,
    },
  },
  {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3-Codex-Spark",
    contextLimit: 128_000,
    reasoningEfforts: STANDARD_CODEX_REASONING_EFFORTS,
  },
];

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
  return normalizeCodexModelId(value) !== undefined;
}

export function normalizeCodexModelId(value: unknown): CodexModelId | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const modelId = value.trim();
  return modelId.length > 0 ? modelId : undefined;
}

export function normalizeCodexModelList(models: readonly string[] | undefined): CodexModelId[] {
  const normalizedModels: CodexModelId[] = [];
  const seen = new Set<string>();

  for (const model of models ?? []) {
    const modelId = normalizeCodexModelId(model);
    if (!modelId || HIDDEN_CODEX_MODEL_IDS.has(modelId) || seen.has(modelId)) {
      continue;
    }

    normalizedModels.push(modelId);
    seen.add(modelId);
  }

  return normalizedModels;
}

function getCodexModel(value: string | undefined) {
  return CODEX_MODELS.find((model) => model.id === value);
}

export function getCodexContextLimit(modelId: string | undefined) {
  return getCodexModel(modelId)?.contextLimit ?? 128_000;
}

export function getCodexReasoningEfforts(modelId: string | undefined): readonly CodexReasoningEffort[] {
  return getCodexModel(modelId)?.reasoningEfforts ?? STANDARD_CODEX_REASONING_EFFORTS;
}

export function selectCodexModel(
  availableModels: readonly string[] | undefined,
  requestedModel?: string,
): CodexModelId | undefined {
  const models = normalizeCodexModelList(availableModels);
  const requested = normalizeCodexModelId(requestedModel);

  if (requested && (models.length === 0 || models.includes(requested))) {
    return requested;
  }

  if (models.includes(PREFERRED_CODEX_MODEL)) {
    return PREFERRED_CODEX_MODEL;
  }

  return models[0];
}

export function getCodexModelOptions(
  availableModels: readonly string[] | undefined,
  selectedModel?: string,
): CodexModelId[] {
  const models = normalizeCodexModelList(availableModels);
  const selected = normalizeCodexModelId(selectedModel);

  if (selected && !models.includes(selected)) {
    return [selected, ...models];
  }

  return models;
}

export function formatCodexModelLabel(modelId: string | undefined) {
  const normalizedModelId = normalizeCodexModelId(modelId);
  if (!normalizedModelId) {
    return "Auto model";
  }

  return getCodexModel(normalizedModelId)?.label ?? normalizedModelId;
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

export const DEFAULT_CODEX_MODEL: CodexModelId = PREFERRED_CODEX_MODEL;
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "low";
