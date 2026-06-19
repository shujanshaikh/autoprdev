export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

export type TokenCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

type TokenUsageMetadata = {
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  cachedInputTokens?: unknown;
  cacheWriteTokens?: unknown;
  cost?: unknown;
};

type TokenCostMetadata = {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  total?: unknown;
};

type AssistantUsageMetadata = {
  usage?: TokenUsageMetadata;
  contextUsage?: TokenUsageMetadata;
  run?: {
    startedAt?: unknown;
    completedAt?: unknown;
    durationSeconds?: unknown;
  };
};

export type AssistantRunMetadata = {
  startedAt?: number;
  completedAt?: number;
  durationSeconds?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asTokenNumber(value: unknown) {
  return asFiniteNumber(value) ?? 0;
}

function isAssistantUsageMetadata(value: unknown): value is AssistantUsageMetadata {
  return (
    isRecord(value) &&
    (value.usage === undefined || isRecord(value.usage)) &&
    (value.contextUsage === undefined || isRecord(value.contextUsage)) &&
    (value.run === undefined || isRecord(value.run))
  );
}

function readTokenUsage(value: unknown): TokenUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasTokenUsage = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheWriteTokens"].some(
    (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
  );

  if (!hasTokenUsage) {
    return null;
  }

  return {
    inputTokens: asTokenNumber(value.inputTokens),
    outputTokens: asTokenNumber(value.outputTokens),
    totalTokens: asTokenNumber(value.totalTokens),
    cachedInputTokens: asTokenNumber(value.cachedInputTokens),
    cacheWriteTokens: asTokenNumber(value.cacheWriteTokens),
  };
}

function readTokenCost(value: unknown): TokenCost | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasTokenCost = ["input", "output", "cacheRead", "cacheWrite", "total"].some(
    (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
  );

  if (!hasTokenCost) {
    return null;
  }

  const cost = value as TokenCostMetadata;

  return {
    input: asTokenNumber(cost.input),
    output: asTokenNumber(cost.output),
    cacheRead: asTokenNumber(cost.cacheRead),
    cacheWrite: asTokenNumber(cost.cacheWrite),
    total: asTokenNumber(cost.total),
  };
}

export function getAssistantContextUsage(metadata: unknown): TokenUsage | null {
  if (!isAssistantUsageMetadata(metadata)) {
    return null;
  }

  return readTokenUsage(metadata.contextUsage) ?? readTokenUsage(metadata.usage);
}

export function getAssistantRunUsage(metadata: unknown): TokenUsage | null {
  if (!isAssistantUsageMetadata(metadata)) {
    return null;
  }

  return readTokenUsage(metadata.usage) ?? readTokenUsage(metadata.contextUsage);
}

export function getAssistantRunCost(metadata: unknown): TokenCost | null {
  if (!isAssistantUsageMetadata(metadata)) {
    return null;
  }

  return readTokenCost(metadata.usage?.cost) ?? readTokenCost(metadata.contextUsage?.cost);
}

export function readAssistantRunMetadata(metadata: unknown): AssistantRunMetadata | null {
  if (!isAssistantUsageMetadata(metadata) || !metadata.run) {
    return null;
  }

  const startedAt = asFiniteNumber(metadata.run.startedAt);
  const completedAt = asFiniteNumber(metadata.run.completedAt);
  const explicitDuration = asFiniteNumber(metadata.run.durationSeconds);
  const durationSeconds =
    explicitDuration ??
    (startedAt !== undefined && completedAt !== undefined
      ? Math.max(0, Math.round((completedAt - startedAt) / 1000))
      : undefined);

  if (startedAt === undefined && completedAt === undefined && durationSeconds === undefined) {
    return null;
  }

  return {
    startedAt,
    completedAt,
    durationSeconds,
  };
}

export function withAssistantRunMetadata(
  metadata: unknown,
  run: Required<AssistantRunMetadata>,
) {
  return {
    ...(isRecord(metadata) ? metadata : {}),
    run,
  };
}

export function contextTokensFromUsage(usage: TokenUsage) {
  return usage.totalTokens > 0 ? usage.totalTokens : usage.inputTokens + usage.outputTokens;
}

export function formatTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }

  return `${value}`;
}

export function formatRunCost(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0.0000";
  }

  if (value < 0.0001) {
    return "<$0.0001";
  }

  if (value < 1) {
    return `$${value.toFixed(4)}`;
  }

  if (value < 10) {
    return `$${value.toFixed(3)}`;
  }

  return `$${value.toFixed(2)}`;
}

export function formatRunDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}
