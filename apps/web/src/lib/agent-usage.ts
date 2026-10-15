import {
  addCodexUsageCosts,
  calculateCodexUsageCost,
  emptyCodexUsageCost,
  type CodexUsageCost,
} from "#/lib/codex-models";

export type AssistantTokenUsageMetadata = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  cost: CodexUsageCost;
};

/** Per-tool call and tool-error counts across the parent and its sub-agents. */
export type AssistantToolUsageMetadata = Record<string, { calls: number; errors: number }>;

export interface AssistantUsageMetadata {
  usage: AssistantTokenUsageMetadata;
  contextUsage: AssistantTokenUsageMetadata;
  steps: {
    parent: number;
    subAgent: number;
  };
  tools: AssistantToolUsageMetadata;
  run: {
    startedAt: number;
    completedAt: number;
    durationSeconds: number;
  };
}

export type AssistantUsageStep = {
  usage: Omit<Partial<AssistantTokenUsageMetadata>, "cost"> & {
    inputTokenDetails?: {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
    outputTokenDetails?: {
      reasoningTokens?: number;
    };
  };
  content?: ReadonlyArray<{ type: string; toolName?: string }>;
};

export type AssistantUsageSource = {
  modelId: string;
  step: AssistantUsageStep;
};

function emptyTokenUsage(): AssistantTokenUsageMetadata {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    cost: emptyCodexUsageCost(),
  };
}

function tokenUsageFromStep(step: AssistantUsageStep, modelId: string): AssistantTokenUsageMetadata {
  const cachedInputTokens =
    step.usage.inputTokenDetails?.cacheReadTokens ?? step.usage.cachedInputTokens ?? 0;
  const usage = {
    inputTokens: step.usage.inputTokens ?? 0,
    outputTokens: step.usage.outputTokens ?? 0,
    totalTokens: step.usage.totalTokens ?? 0,
    cachedInputTokens,
    cacheWriteTokens:
      step.usage.inputTokenDetails?.cacheWriteTokens ?? step.usage.cacheWriteTokens ?? 0,
    reasoningTokens:
      step.usage.outputTokenDetails?.reasoningTokens ?? step.usage.reasoningTokens ?? 0,
  };

  return {
    ...usage,
    cost: calculateCodexUsageCost(modelId, usage),
  };
}

function addTokenUsage(
  total: AssistantTokenUsageMetadata,
  usage: AssistantTokenUsageMetadata,
): AssistantTokenUsageMetadata {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    totalTokens: total.totalTokens + usage.totalTokens,
    cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
    cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
    reasoningTokens: total.reasoningTokens + usage.reasoningTokens,
    cost: addCodexUsageCosts(total.cost, usage.cost),
  };
}

function countToolUsage(steps: readonly AssistantUsageStep[]): AssistantToolUsageMetadata {
  const tools: AssistantToolUsageMetadata = {};
  for (const part of steps.flatMap((step) => step.content ?? [])) {
    if (!part.toolName || (part.type !== "tool-call" && part.type !== "tool-error")) continue;
    const counts = tools[part.toolName] ??= { calls: 0, errors: 0 };
    if (part.type === "tool-call") counts.calls += 1;
    else counts.errors += 1;
  }
  return tools;
}

export function createAssistantUsageMetadata(
  steps: readonly AssistantUsageStep[],
  modelId: string,
  startedAt: number,
  completedAt = Date.now(),
  additionalUsageSteps: readonly AssistantUsageSource[] = [],
): AssistantUsageMetadata {
  const stepUsages = [
    ...steps.map((step) => tokenUsageFromStep(step, modelId)),
    ...additionalUsageSteps.map((source) =>
      tokenUsageFromStep(source.step, source.modelId)),
  ];
  const contextStep = steps.at(-1);

  return {
    usage: stepUsages.reduce(addTokenUsage, emptyTokenUsage()),
    contextUsage: contextStep
      ? tokenUsageFromStep(contextStep, modelId)
      : emptyTokenUsage(),
    steps: {
      parent: steps.length,
      subAgent: additionalUsageSteps.length,
    },
    tools: countToolUsage([...steps, ...additionalUsageSteps.map((source) => source.step)]),
    run: {
      startedAt,
      completedAt,
      durationSeconds: Math.max(0, Math.round((completedAt - startedAt) / 1_000)),
    },
  };
}

/** Flat attributes for one structured log line per agent run, for cost-per-task analysis. */
export function usageLogAttributes(metadata: AssistantUsageMetadata) {
  const { usage } = metadata;
  return {
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    uncachedInputTokens: Math.max(0, usage.inputTokens - usage.cachedInputTokens),
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheHitRate: usage.inputTokens > 0 ? usage.cachedInputTokens / usage.inputTokens : 0,
    costTotal: usage.cost.total,
    parentSteps: metadata.steps.parent,
    subAgentSteps: metadata.steps.subAgent,
    contextInputTokens: metadata.contextUsage.inputTokens,
    durationSeconds: metadata.run.durationSeconds,
    tools: JSON.stringify(metadata.tools),
  };
}
