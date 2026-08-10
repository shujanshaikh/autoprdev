import { CHATGPT_CODEX_MODEL_LIMITS } from "@autopr/chatgpt/codex-model-limits";

const STANDARD_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
const MAX_REASONING_EFFORTS = [...STANDARD_REASONING_EFFORTS, "max"] as const;
const ULTRA_REASONING_EFFORTS = [...MAX_REASONING_EFFORTS, "ultra"] as const;
const HIDDEN_MODEL_IDS = new Set(["codex-auto-review"]);

export type CodexReasoningEffort = (typeof ULTRA_REASONING_EFFORTS)[number];

type ModelDefinition = {
  id: string;
  label: string;
  contextLimit: number;
  reasoningEfforts: readonly CodexReasoningEffort[];
};

const MODELS: readonly ModelDefinition[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", contextLimit: CHATGPT_CODEX_MODEL_LIMITS["gpt-5.6-sol"].contextWindowTokens, reasoningEfforts: ULTRA_REASONING_EFFORTS },
  { id: "gpt-5.6-terra", label: "GPT-5.6-Terra", contextLimit: CHATGPT_CODEX_MODEL_LIMITS["gpt-5.6-terra"].contextWindowTokens, reasoningEfforts: ULTRA_REASONING_EFFORTS },
  { id: "gpt-5.6-luna", label: "GPT-5.6-Luna", contextLimit: CHATGPT_CODEX_MODEL_LIMITS["gpt-5.6-luna"].contextWindowTokens, reasoningEfforts: MAX_REASONING_EFFORTS },
  { id: "gpt-5.5", label: "GPT-5.5", contextLimit: 272_000, reasoningEfforts: STANDARD_REASONING_EFFORTS },
  { id: "gpt-5.4", label: "GPT-5.4", contextLimit: 272_000, reasoningEfforts: STANDARD_REASONING_EFFORTS },
  { id: "gpt-5.4-mini", label: "GPT-5.4-Mini", contextLimit: 272_000, reasoningEfforts: STANDARD_REASONING_EFFORTS },
  {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3-Codex-Spark",
    contextLimit: 128_000,
    reasoningEfforts: STANDARD_REASONING_EFFORTS,
  },
];

const REASONING_EFFORT_DESCRIPTIONS: Record<CodexReasoningEffort, string> = {
  low: "Fastest replies. Best for small, well-scoped edits.",
  medium: "Balanced speed and depth for everyday tasks.",
  high: "Thinks longer before acting on tricky changes.",
  xhigh: "Extended reasoning for complex, multi-file work.",
  max: "Deliberates as long as the model allows.",
  ultra: "The longest thinking budget. Slowest, most thorough.",
};

export const PREFERRED_CODEX_MODEL = "gpt-5.6-sol";
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "low";

export function normalizeCodexModelList(models: readonly string[] | undefined) {
  const seen = new Set<string>();
  return (models ?? []).flatMap((value) => {
    const model = value.trim();
    if (!model || HIDDEN_MODEL_IDS.has(model) || seen.has(model)) return [];
    seen.add(model);
    return [model];
  });
}

export function selectCodexModel(availableModels: readonly string[] | undefined, requested?: string) {
  const models = normalizeCodexModelList(availableModels);
  const requestedModel = requested?.trim();
  if (requestedModel && (models.length === 0 || models.includes(requestedModel))) return requestedModel;
  if (models.includes(PREFERRED_CODEX_MODEL)) return PREFERRED_CODEX_MODEL;
  return models[0];
}

export function getCodexModelOptions(availableModels: readonly string[] | undefined, selected?: string) {
  const models = normalizeCodexModelList(availableModels);
  return selected && !models.includes(selected) ? [selected, ...models] : models;
}

export function getCodexReasoningEfforts(modelId: string | undefined): readonly CodexReasoningEffort[] {
  return MODELS.find((model) => model.id === modelId)?.reasoningEfforts ?? STANDARD_REASONING_EFFORTS;
}

export function isCodexReasoningEffortForModel(
  modelId: string | undefined,
  value: unknown,
): value is CodexReasoningEffort {
  return typeof value === "string" && getCodexReasoningEfforts(modelId).includes(value as CodexReasoningEffort);
}

export function formatCodexModelLabel(modelId: string | undefined) {
  if (!modelId) return "Auto model";
  return MODELS.find((model) => model.id === modelId)?.label ?? modelId;
}

export function formatReasoningEffort(value: CodexReasoningEffort) {
  return value === "xhigh" ? "Extra high" : value[0]?.toUpperCase() + value.slice(1);
}

export function describeReasoningEffort(value: CodexReasoningEffort) {
  return REASONING_EFFORT_DESCRIPTIONS[value];
}

/** Short context-window label for the model picker, for example "272K context". */
export function formatCodexContextLimit(modelId: string | undefined) {
  const contextLimit = MODELS.find((model) => model.id === modelId)?.contextLimit;
  if (!contextLimit) return undefined;
  return `${Math.round(contextLimit / 1000)}K context`;
}
