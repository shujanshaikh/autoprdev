export const CODEX_MODELS = [
  { id: "gpt-5.5", label: "GPT-5.5", contextLimit: 1_000_000 },
  { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", contextLimit: 400_000 },
  { id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", contextLimit: 400_000 },
  { id: "gpt-5.1-codex", label: "GPT-5.1 Codex", contextLimit: 400_000 },
  { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", contextLimit: 400_000 },
  { id: "gpt-5-codex", label: "GPT-5 Codex", contextLimit: 400_000 },
] as const;

export type CodexModelId = (typeof CODEX_MODELS)[number]["id"];

export function isCodexModelId(value: unknown): value is CodexModelId {
  return typeof value === "string" && CODEX_MODELS.some((model) => model.id === value);
}

export const DEFAULT_CODEX_MODEL: CodexModelId = "gpt-5.5";
