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
  cost: CodexUsageCost;
};

export interface AssistantUsageMetadata {
  usage: AssistantTokenUsageMetadata;
  contextUsage: AssistantTokenUsageMetadata;
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
  };
};

function emptyTokenUsage(): AssistantTokenUsageMetadata {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
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
    cost: addCodexUsageCosts(total.cost, usage.cost),
  };
}

export function createAssistantUsageMetadata(
  steps: readonly AssistantUsageStep[],
  modelId: string,
  startedAt: number,
  completedAt = Date.now(),
  additionalUsageSteps: readonly AssistantUsageStep[] = [],
): AssistantUsageMetadata {
  const stepUsages = [...steps, ...additionalUsageSteps].map((step) => tokenUsageFromStep(step, modelId));
  const contextStep = steps.at(-1);

  return {
    usage: stepUsages.reduce(addTokenUsage, emptyTokenUsage()),
    contextUsage: contextStep
      ? tokenUsageFromStep(contextStep, modelId)
      : emptyTokenUsage(),
    run: {
      startedAt,
      completedAt,
      durationSeconds: Math.max(0, Math.round((completedAt - startedAt) / 1_000)),
    },
  };
}
