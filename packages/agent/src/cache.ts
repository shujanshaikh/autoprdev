import type { ModelMessage, SystemModelMessage } from "ai";

type ProviderOptions = Record<string, unknown>;
type ProviderOptionsHolder = {
  providerOptions?: ProviderOptions;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeProviderOptions(base: ProviderOptions | undefined, next: ProviderOptions): ProviderOptions {
  const result: ProviderOptions = { ...(base ?? {}) };

  for (const [key, value] of Object.entries(next)) {
    const existing = result[key];
    result[key] = isRecord(existing) && isRecord(value) ? mergeProviderOptions(existing, value) : value;
  }

  return result;
}

function cloneContent(content: ModelMessage["content"]): ModelMessage["content"] {
  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((part) => (isRecord(part) ? { ...part } : part)) as ModelMessage["content"];
}

function withProviderOptions<T extends ProviderOptionsHolder>(value: T): T {
  return {
    ...value,
    providerOptions: mergeProviderOptions(value.providerOptions, CACHE_PROVIDER_OPTIONS),
  };
}

function markMessageForCache(message: ModelMessage): ModelMessage {
  const content = cloneContent(message.content);

  if (Array.isArray(content) && content.length > 0) {
    const nextContent = [...content] as unknown[];
    const lastPart = nextContent[nextContent.length - 1];

    if (isRecord(lastPart)) {
      nextContent[nextContent.length - 1] = withProviderOptions(lastPart as ProviderOptionsHolder);
      return {
        ...message,
        content: nextContent,
      } as unknown as ModelMessage;
    }
  }

  return withProviderOptions({
    ...message,
    content,
  } as unknown as ModelMessage & ProviderOptionsHolder) as unknown as ModelMessage;
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

    return {
      ...message,
      content: cloneContent(message.content),
    } as unknown as ModelMessage;
  });
}

export function createCachedSystemMessage(content: string): SystemModelMessage {
  return withProviderOptions({
    role: "system",
    content,
  } as SystemModelMessage & ProviderOptionsHolder) as SystemModelMessage;
}
