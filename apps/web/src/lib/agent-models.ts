import { hasStringType } from "@autopr/config/runtime-type";


import { DEFAULT_CODEX_REASONING_EFFORT, formatCodexModelLabel, getCodexContextLimit, getCodexReasoningEfforts, normalizeCodexModelList, selectCodexModel, type CodexReasoningEffort } from "#/lib/codex-models";

export const AGENT_PROVIDERS = ["openai-codex", "xai"] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];
export type AgentModelSelection = {
  provider: AgentProvider;
  modelId: string;
};

export type AgentModelOption = AgentModelSelection & {
  key: string;
  label: string;
};

export function isAgentProvider<ValueValue>(value: ValueValue): value is ValueValue & (AgentProvider) {
  return hasStringType(value) && AGENT_PROVIDERS.includes(/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ value as AgentProvider);
}

export function agentModelKey(selection: AgentModelSelection) {
  return `${selection.provider}:${selection.modelId}`;
}

export function getAgentModelOptions(options: {
  codexModels?: readonly string[];
  grokModels?: readonly string[];
}) {
  return [
    ...normalizeCodexModelList(options.codexModels).map((modelId) => modelOption("openai-codex", modelId)),
    ...normalizeGrokModelList(options.grokModels).map((modelId) => modelOption("xai", modelId)),
  ];
}

export function selectAgentModel(
  options: readonly AgentModelOption[],
  requested?: Partial<AgentModelSelection>,
): AgentModelSelection | undefined {
  const exact = requested?.provider && requested.modelId
    ? options.find((option) => option.provider === requested.provider && option.modelId === requested.modelId)
    : undefined;
  if (exact) return { provider: exact.provider, modelId: exact.modelId };

  if (requested?.provider) {
    const providerDefault = selectProviderModel(options, requested.provider);
    if (providerDefault) return providerDefault;
  }

  const codexDefault = selectProviderModel(options, "openai-codex");
  return codexDefault ?? selectProviderModel(options, "xai");
}

export function getAgentReasoningEfforts(selection: AgentModelSelection | undefined): readonly CodexReasoningEffort[] {
  if (!selection) return [];
  if (selection.provider === "openai-codex") return getCodexReasoningEfforts(selection.modelId);
  const modelId = selection.modelId.toLowerCase();
  if (modelId.includes("grok-4.20") && modelId.includes("multi-agent")) {
    return ["low", "medium", "high", "xhigh"];
  }
  if (modelId.includes("non-reasoning")) return [];
  if (modelId.includes("grok-4.5") || modelId.includes("grok-4.3") || modelId.includes("grok-4.20")) {
    return ["low", "medium", "high"];
  }
  return modelId.includes("grok-3-mini") ? ["low", "high"] : [];
}

export function selectAgentReasoningEffort(
  selection: AgentModelSelection | undefined,
  requested: CodexReasoningEffort | undefined,
) {
  const efforts = getAgentReasoningEfforts(selection);
  if (requested && efforts.includes(requested)) return requested;
  if (selection?.provider === "xai" && efforts.includes("high")) return "high";
  return efforts.includes(DEFAULT_CODEX_REASONING_EFFORT) ? DEFAULT_CODEX_REASONING_EFFORT : efforts[0];
}

export function isAgentReasoningEffortSupported<RequestedValue>(
  selection: AgentModelSelection | undefined,
  requested: RequestedValue,
): requested is RequestedValue & (CodexReasoningEffort) {
  return hasStringType(requested)
    && getAgentReasoningEfforts(selection).includes(/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ requested as CodexReasoningEffort);
}

export function getAgentContextLimit(selection: AgentModelSelection | undefined) {
  if (!selection) return 128_000;
  if (selection.provider === "openai-codex") return getCodexContextLimit(selection.modelId);
  if (/grok-4\.(?:20|3)/i.test(selection.modelId)) return 1_000_000;
  if (/grok-4\.5/i.test(selection.modelId) || selection.modelId.toLowerCase() === "grok-build-latest") return 500_000;
  if (/grok-4(?:$|-)/i.test(selection.modelId)) return 256_000;
  if (/grok-(?:build|code)/i.test(selection.modelId)) return 256_000;
  return 128_000;
}

export function normalizeGrokModelList(models: readonly string[] | undefined) {
  const normalized = new Set<string>();
  for (const model of models ?? []) {
    const modelId = model.trim();
    if (modelId) normalized.add(modelId);
  }
  return [...normalized];
}

export function formatAgentModelLabel(selection: AgentModelSelection | undefined) {
  if (!selection) return "Auto model";
  if (selection.provider === "openai-codex") return formatCodexModelLabel(selection.modelId);
  return selection.modelId
    .split("-")
    .map((part) => part.toLowerCase() === "grok" ? "Grok" : part)
    .join("-");
}

function modelOption(provider: AgentProvider, modelId: string): AgentModelOption {
  const selection = { provider, modelId };
  return {
    ...selection,
    key: agentModelKey(selection),
    label: formatAgentModelLabel(selection),
  };
}

function selectProviderModel(options: readonly AgentModelOption[], provider: AgentProvider) {
  const providerOptions = options.filter((option) => option.provider === provider);
  if (providerOptions.length === 0) return undefined;
  const selectedModel = provider === "openai-codex"
    ? selectCodexModel(providerOptions.map((option) => option.modelId))
    : providerOptions.find((option) => option.modelId === "grok-4.5")?.modelId
      ?? providerOptions.find((option) => option.modelId === "grok-build-0.1")?.modelId
      ?? providerOptions.find((option) => option.modelId === "grok-code-fast-1")?.modelId
      ?? providerOptions.find((option) => option.modelId === "grok-4")?.modelId
      ?? providerOptions[0]?.modelId;
  return selectedModel ? { provider, modelId: selectedModel } : undefined;
}
