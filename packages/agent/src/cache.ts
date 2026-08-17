import { isJsonObject, type JsonObject } from "@autopr/config/runtime-value";

import type { ModelMessage, SystemModelMessage } from "ai";

type ProviderOptions = JsonObject;
const CACHE_PROVIDER_OPTIONS = {
  anthropic: {
    cacheControl: { type: "ephemeral" },
  },
  openrouter: {
    cacheControl: { type: "ephemeral" },
  },
  bedrock: {
    cachePoint: { type: "default" },
  },
  openaiCompatible: {
    cache_control: { type: "ephemeral" },
  },
  copilot: {
    copilot_cache_control: { type: "ephemeral" },
  },
  alibaba: {
    cacheControl: { type: "ephemeral" },
  },
} satisfies ProviderOptions;

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}

function mergeProviderOptions(base: ProviderOptions | undefined, next: ProviderOptions): ProviderOptions {
  const result: ProviderOptions = { ...base };

  for (const [key, value] of Object.entries(next)) {
    const existing = result[key];
    result[key] = isRecord(existing) && isRecord(value) ? mergeProviderOptions(existing, value) : value;
  }

  return result;
}

function applyProviderOptions(value: JsonObject): void {
  const current = isRecord(value.providerOptions) ? value.providerOptions : undefined;
  value.providerOptions = mergeProviderOptions(current, CACHE_PROVIDER_OPTIONS);
}

function markMessageForCache(message: ModelMessage): ModelMessage {
  const nextMessage = structuredClone(message);
  const { content } = nextMessage;

  if (Array.isArray(content) && content.length > 0) {
    const lastPart = content[content.length - 1];

    if (isRecord(lastPart)) {
      applyProviderOptions(lastPart);
      return nextMessage;
    }
  }

  const current = "providerOptions" in nextMessage && isRecord(nextMessage.providerOptions)
    ? nextMessage.providerOptions
    : undefined;
  Object.assign(nextMessage, {
    providerOptions: mergeProviderOptions(current, CACHE_PROVIDER_OPTIONS),
  });
  return nextMessage;
}

function cacheCandidateIndexes(messages: ModelMessage[]): number[] {
  const systemIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === "system")
    .slice(0, 2)
    .map(({ index }) => index);
  const recentIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role !== "system")
    .slice(-2)
    .map(({ index }) => index);

  return [...new Set([...systemIndexes, ...recentIndexes])];
}

export function applyAgenticCache(messages: ModelMessage[]): ModelMessage[] {
  const cacheIndexes = new Set(cacheCandidateIndexes(messages));

  return messages.map((message, index) => {
    if (cacheIndexes.has(index)) {
      return markMessageForCache(message);
    }

    return structuredClone(message);
  });
}

export function createCachedSystemMessage(content: string): SystemModelMessage {
  const message: SystemModelMessage = {
    role: "system",
    content,
  };
  Object.assign(message, { providerOptions: CACHE_PROVIDER_OPTIONS });
  return message;
}
