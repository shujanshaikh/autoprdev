import { hasNumberType } from "@autopr/config/runtime-type";
import { isJsonObject, type JsonObject } from "@autopr/config/runtime-value";

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

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}

function asFiniteNumber<ValueValue>(value: ValueValue) {
  return hasNumberType(value) && Number.isFinite(value) ? value : undefined;
}

function asTokenNumber<ValueValue>(value: ValueValue) {
  return asFiniteNumber(value) ?? 0;
}

function isAssistantUsageMetadata<ValueValue>(value: ValueValue): value is ValueValue & (AssistantUsageMetadata) {
  return (
    isRecord(value) &&
    (value.usage === undefined || isRecord(value.usage)) &&
    (value.contextUsage === undefined || isRecord(value.contextUsage)) &&
    (value.run === undefined || isRecord(value.run))
  );
}

function readTokenUsage<ValueValue>(value: ValueValue): TokenUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasTokenUsage = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheWriteTokens"].some(
    (key) => hasNumberType(value[key]) && Number.isFinite(value[key]),
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

function readTokenCost<ValueValue>(value: ValueValue): TokenCost | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasTokenCost = ["input", "output", "cacheRead", "cacheWrite", "total"].some(
    (key) => hasNumberType(value[key]) && Number.isFinite(value[key]),
  );

  if (!hasTokenCost) {
    return null;
  }

  const cost = value satisfies TokenCostMetadata;

  return {
    input: asTokenNumber(cost.input),
    output: asTokenNumber(cost.output),
    cacheRead: asTokenNumber(cost.cacheRead),
    cacheWrite: asTokenNumber(cost.cacheWrite),
    total: asTokenNumber(cost.total),
  };
}

export function getAssistantContextUsage<MetadataValue>(metadata: MetadataValue): TokenUsage | null {
  if (!isAssistantUsageMetadata(metadata)) {
    return null;
  }

  return readTokenUsage(metadata.contextUsage) ?? readTokenUsage(metadata.usage);
}

export function getAssistantRunUsage<MetadataValue>(metadata: MetadataValue): TokenUsage | null {
  if (!isAssistantUsageMetadata(metadata)) {
    return null;
  }

  return readTokenUsage(metadata.usage) ?? readTokenUsage(metadata.contextUsage);
}

export function getAssistantRunCost<MetadataValue>(metadata: MetadataValue): TokenCost | null {
  if (!isAssistantUsageMetadata(metadata)) {
    return null;
  }

  return readTokenCost(metadata.usage?.cost) ?? readTokenCost(metadata.contextUsage?.cost);
}

export function readAssistantRunMetadata<MetadataValue>(metadata: MetadataValue): AssistantRunMetadata | null {
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

export function withAssistantRunMetadata<MetadataValue>(
  metadata: MetadataValue,
  run: Required<AssistantRunMetadata>,
) {
  return {
    ...(() => {
  let optionalProperties;
  if (isRecord(metadata)) optionalProperties = metadata;
  return optionalProperties;
})(),
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
