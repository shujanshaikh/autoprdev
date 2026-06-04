export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export const CODEX_MODELS = [
  { id: "gpt-5.5", label: "GPT-5.5", contextLimit: 272_000, reasoningEfforts: CODEX_REASONING_EFFORTS },
  { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", contextLimit: 400_000, reasoningEfforts: CODEX_REASONING_EFFORTS },
  { id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", contextLimit: 400_000, reasoningEfforts: CODEX_REASONING_EFFORTS },
  { id: "gpt-5.1-codex", label: "GPT-5.1 Codex", contextLimit: 400_000, reasoningEfforts: ["low", "medium", "high"] },
  { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", contextLimit: 400_000, reasoningEfforts: ["low", "medium", "high"] },
  { id: "gpt-5-codex", label: "GPT-5 Codex", contextLimit: 400_000, reasoningEfforts: ["low", "medium", "high"] },
] as const;

export type CodexModelId = (typeof CODEX_MODELS)[number]["id"];

export function isCodexModelId(value: unknown): value is CodexModelId {
  return typeof value === "string" && CODEX_MODELS.some((model) => model.id === value);
}

export function getCodexModel(value: string | undefined) {
  return CODEX_MODELS.find((model) => model.id === value);
}

export function getCodexReasoningEfforts(modelId: string | undefined): readonly CodexReasoningEffort[] {
  return getCodexModel(modelId)?.reasoningEfforts ?? CODEX_REASONING_EFFORTS;
}

export function isCodexReasoningEffortForModel(
  modelId: string | undefined,
  value: unknown,
): value is CodexReasoningEffort {
  return typeof value === "string" && getCodexReasoningEfforts(modelId).includes(value as CodexReasoningEffort);
}

export const DEFAULT_CODEX_MODEL: CodexModelId = "gpt-5.5";
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "low";
