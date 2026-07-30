import {
  streamText,
  type LanguageModel,
  type LanguageModelMiddleware,
  type ModelMessage,
  type PrepareStepFunction,
} from "ai";

import { compactPromptMessagesForModel } from "./agent-message-compaction";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const COMPACTION_RESERVE_TOKENS = 24_000;
const KEEP_RECENT_TOKENS = 16_000;
const SUMMARY_CHUNK_CHARS = 80_000;
const SUMMARY_MAX_CHARS = 24_000;
const TOOL_OUTPUT_MAX_CHARS = 60_000;
const TOOL_OUTPUT_PREVIEW_CHARS = 4_000;
const EMERGENCY_TAIL_CHARS = [80_000, 32_000] as const;

const SUMMARY_SYSTEM_PROMPT = `You create context checkpoints for a coding agent.

Summarize the supplied conversation so another agent can continue the work without repeating completed actions. Do not continue the task and do not answer the conversation. Preserve exact file paths, commands, errors, constraints, decisions, unfinished work, and important tool results.`;

const SUMMARY_PROMPT = `Return a concise checkpoint using exactly these sections:

## Goal
## Constraints
## Completed
## In Progress
## Key Decisions
## Next Steps
## Critical Context

Update the previous checkpoint when one is present. Do not omit still-relevant facts from it.`;

type SummaryInput = {
  previousSummary?: string;
  conversation: string;
  model: LanguageModel;
  abortSignal?: AbortSignal;
};

export type AgentContextCompactorOptions = {
  contextWindow?: number;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  summarize?: (input: SummaryInput) => Promise<string>;
};

type CompactionState = {
  firstMessage: ModelMessage | undefined;
  summarizedThrough: number;
  summary: string;
};

type MiddlewareWrapStream = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type MiddlewareStreamOptions = Parameters<MiddlewareWrapStream>[0];
type ProviderPrompt = MiddlewareStreamOptions["params"]["prompt"];
type ProviderStreamResult = Awaited<ReturnType<MiddlewareStreamOptions["model"]["doStream"]>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  const headChars = Math.ceil(maxChars * 0.65);
  const tailChars = Math.floor(maxChars * 0.25);
  return `${value.slice(0, headChars)}\n\n[${value.length - headChars - tailChars} characters omitted]\n\n${value.slice(-tailChars)}`;
}

function compactUnknown(value: unknown, maxStringChars = TOOL_OUTPUT_PREVIEW_CHARS, depth = 0): unknown {
  if (typeof value === "string") {
    return truncateText(value, maxStringChars);
  }
  if (depth >= 6) {
    return "[nested value omitted]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => compactUnknown(item, maxStringChars, depth + 1));
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, item]) => [key, compactUnknown(item, maxStringChars, depth + 1)]),
  );
}

function compactToolOutput(output: unknown, maxChars = TOOL_OUTPUT_MAX_CHARS) {
  const serialized = safeJsonStringify(output);
  if (serialized.length <= maxChars) {
    return output;
  }

  return {
    type: "text" as const,
    value: `${truncateText(serialized, TOOL_OUTPUT_PREVIEW_CHARS)}\n\n[Earlier tool output compacted: ${serialized.length} characters]`,
  };
}

function capLargeToolOutputs(messages: ModelMessage[]) {
  return messages.map((message): ModelMessage => {
    if (!Array.isArray(message.content)) {
      return message;
    }

    if (message.role !== "tool" && message.role !== "assistant") {
      return message;
    }

    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "tool-result"
          ? { ...part, output: compactToolOutput(part.output) }
          : part,
      ),
    } as ModelMessage;
  });
}

function messageTokenEstimate(message: ModelMessage) {
  if (typeof message.content === "string") {
    return Math.ceil(message.content.length / 4) + 4;
  }

  let chars = 0;
  for (const part of message.content) {
    if (part.type === "text") {
      chars += part.text.length;
      continue;
    }
    if (part.type === "image" || part.type === "file") {
      chars += 8_000;
      continue;
    }
    if (part.type === "reasoning") {
      chars += part.text.length;
      continue;
    }
    if (part.type === "tool-call") {
      chars += part.toolName.length + safeJsonStringify(part.input).length;
      continue;
    }
    if (part.type === "tool-result") {
      chars += part.toolName.length + safeJsonStringify(part.output).length;
      continue;
    }
    chars += safeJsonStringify(part).length;
  }

  return Math.ceil(chars / 4) + 4;
}

export function estimateModelMessagesTokens(messages: ModelMessage[]) {
  return messages.reduce((total, message) => total + messageTokenEstimate(message), 0);
}

function summaryMessage(summary: string): ModelMessage {
  return {
    role: "user",
    content: `<context-checkpoint>\nThe earlier conversation was compacted. Treat this checkpoint as prior context and continue from the retained messages that follow.\n\n${summary}\n</context-checkpoint>`,
  };
}

function findTailStart(messages: ModelMessage[], keepRecentTokens: number) {
  let accumulated = 0;
  let start = messages.length;

  for (let index = messages.length - 1; index >= 0; index--) {
    const tokens = messageTokenEstimate(messages[index]);
    if (accumulated + tokens > keepRecentTokens && start < messages.length) {
      break;
    }
    accumulated += tokens;
    if (messages[index].role !== "tool") {
      start = index;
    }
    if (accumulated >= keepRecentTokens && start < messages.length) {
      break;
    }
  }

  return start;
}

function serializeContentPart(part: unknown) {
  if (!isRecord(part) || typeof part.type !== "string") {
    return truncateText(safeJsonStringify(part), TOOL_OUTPUT_PREVIEW_CHARS);
  }
  if (part.type === "text" && typeof part.text === "string") {
    return part.text;
  }
  if (part.type === "reasoning") {
    return "[assistant reasoning omitted]";
  }
  if (part.type === "image" || part.type === "file") {
    return `[${part.type} attachment${typeof part.filename === "string" ? `: ${part.filename}` : ""}]`;
  }
  if (part.type === "tool-call") {
    return `[tool call: ${String(part.toolName)}]\n${truncateText(safeJsonStringify(part.input), TOOL_OUTPUT_PREVIEW_CHARS)}`;
  }
  if (part.type === "tool-result") {
    return `[tool result: ${String(part.toolName)}]\n${truncateText(safeJsonStringify(part.output), TOOL_OUTPUT_PREVIEW_CHARS * 2)}`;
  }
  return `[${part.type}] ${truncateText(safeJsonStringify(compactUnknown(part)), TOOL_OUTPUT_PREVIEW_CHARS)}`;
}

function serializeMessages(messages: ModelMessage[]) {
  return messages.map((message, index) => {
    const content = typeof message.content === "string"
      ? message.content
      : message.content.map(serializeContentPart).join("\n");
    return `--- message ${index + 1} (${message.role}) ---\n${content}`;
  });
}

function chunkSerializedMessages(messages: ModelMessage[]) {
  const chunks: string[] = [];
  let current = "";

  for (const serialized of serializeMessages(messages)) {
    const next = truncateText(serialized, SUMMARY_CHUNK_CHARS);
    if (current && current.length + next.length + 2 > SUMMARY_CHUNK_CHARS) {
      chunks.push(current);
      current = next;
      continue;
    }
    current = current ? `${current}\n\n${next}` : next;
  }
  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function fallbackSummary(previousSummary: string | undefined, conversation: string) {
  return truncateText(
    [
      previousSummary,
      previousSummary ? "## Newly Compacted Context" : "## Compacted Context",
      conversation,
      "## Recovery Note\nThe model-generated checkpoint was unavailable, so this compact transcript preserves the most recent details.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    SUMMARY_MAX_CHARS,
  );
}

async function generateCheckpoint({
  previousSummary,
  conversation,
  model,
  abortSignal,
}: SummaryInput) {
  // The ChatGPT-backed Codex responses endpoint rejects non-streaming requests,
  // so checkpoints stream and collect their text instead of using `generateText`.
  const result = streamText({
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: [
      previousSummary ? `<previous-checkpoint>\n${previousSummary}\n</previous-checkpoint>` : undefined,
      `<conversation>\n${conversation}\n</conversation>`,
      SUMMARY_PROMPT,
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxOutputTokens: 6_000,
    maxRetries: 1,
    abortSignal,
    providerOptions: {
      openai: {
        store: false,
      },
    },
  });

  return await result.text;
}

async function summarizeMessages(
  messages: ModelMessage[],
  previousSummary: string | undefined,
  model: LanguageModel,
  options: AgentContextCompactorOptions,
) {
  let summary = previousSummary;
  for (const conversation of chunkSerializedMessages(messages)) {
    try {
      const generated = await (options.summarize ?? generateCheckpoint)({
        previousSummary: summary,
        conversation,
        model,
        abortSignal: options.abortSignal,
      });
      summary = generated.trim()
        ? truncateText(generated.trim(), SUMMARY_MAX_CHARS)
        : fallbackSummary(summary, conversation);
    } catch (error) {
      if (options.abortSignal?.aborted) {
        throw error;
      }
      console.warn("Agent context summarization failed; using deterministic checkpoint", error);
      summary = fallbackSummary(summary, conversation);
    }
  }

  return summary ?? "No earlier context was available.";
}

/**
 * Builds a stateful prepareStep hook. It follows pi's checkpoint-and-tail model,
 * with OpenCode-style output pruning and incremental checkpoint updates.
 */
export function createAgentContextCompactor(
  options: AgentContextCompactorOptions,
): PrepareStepFunction {
  const contextWindow = Math.max(32_000, options.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
  const reserveTokens = Math.min(COMPACTION_RESERVE_TOKENS, Math.floor(contextWindow * 0.25));
  const usableTokens = contextWindow - reserveTokens;
  const systemTokens = Math.ceil((options.systemPrompt?.length ?? 0) / 4);
  let state: CompactionState | undefined;

  return async ({ messages, model, steps }) => {
    const compacted = capLargeToolOutputs(compactPromptMessagesForModel(messages));
    const stateMatches = state
      && state.firstMessage === messages[0]
      && state.summarizedThrough <= messages.length;
    if (!stateMatches) {
      state = undefined;
    }

    const activeMessages = state
      ? [summaryMessage(state.summary), ...compacted.slice(state.summarizedThrough)]
      : compacted;
    const lastProviderInput = steps.at(-1)?.usage.inputTokens ?? 0;
    const estimatedTokens = Math.max(
      systemTokens + estimateModelMessagesTokens(activeMessages),
      lastProviderInput,
    );

    if (estimatedTokens < usableTokens) {
      return { messages: activeMessages };
    }

    const tailStart = Math.max(
      state?.summarizedThrough ?? 0,
      findTailStart(compacted, Math.min(KEEP_RECENT_TOKENS, Math.floor(usableTokens * 0.25))),
    );
    if (tailStart <= (state?.summarizedThrough ?? 0) && state) {
      return { messages: activeMessages };
    }
    if (tailStart <= 0) {
      return { messages: activeMessages };
    }

    const summary = await summarizeMessages(
      compacted.slice(state?.summarizedThrough ?? 0, tailStart),
      state?.summary,
      model,
      options,
    );
    state = {
      firstMessage: messages[0],
      summarizedThrough: tailStart,
      summary,
    };

    return {
      messages: [summaryMessage(summary), ...compacted.slice(tailStart)],
    };
  };
}

function errorStrings(error: unknown, seen = new Set<object>()): string[] {
  if (typeof error === "string") {
    return [error];
  }
  if (!isRecord(error) || seen.has(error)) {
    return [];
  }
  seen.add(error);

  return Object.entries(error).flatMap(([key, value]) => {
    if (typeof value === "string") {
      return [key, value];
    }
    return errorStrings(value, seen);
  });
}

export function isContextOverflowError(error: unknown) {
  const text = [
    error instanceof Error ? error.message : undefined,
    ...errorStrings(error),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return [
    "context_length_exceeded",
    "context length exceeded",
    "exceeds the context window",
    "maximum context length",
    "context window of this model",
    "too many tokens",
    "prompt is too long",
    "input is too long",
  ].some((pattern) => text.includes(pattern));
}

function providerMessageChars(message: ProviderPrompt[number]) {
  return safeJsonStringify(message).length;
}

function compactProviderMessage(
  message: ProviderPrompt[number],
  attempt: number,
): ProviderPrompt[number] {
  if (message.role === "system") {
    return message;
  }

  const textLimit = attempt === 1 ? 16_000 : 6_000;
  const content: unknown[] = [];
  for (const part of message.content) {
    if (part.type === "reasoning") {
      continue;
    }
    if (part.type === "text") {
      content.push({ ...part, text: truncateText(part.text, textLimit) });
      continue;
    }
    if (part.type === "file") {
      content.push({
        type: "text" as const,
        text: `[Attachment omitted during context recovery: ${part.filename ?? part.mediaType}]`,
      });
      continue;
    }
    if (part.type === "tool-call") {
      content.push({ ...part, input: compactUnknown(part.input, textLimit) });
      continue;
    }
    if (part.type === "tool-result") {
      content.push({ ...part, output: compactToolOutput(part.output, textLimit) });
      continue;
    }
    content.push(part);
  }

  return { ...message, content } as ProviderPrompt[number];
}

function serializeProviderHead(messages: ProviderPrompt) {
  return truncateText(
    messages
      .map((message) => {
        const content = message.role === "system"
          ? message.content
          : message.content.map((part) => {
              if (part.type === "text") return part.text;
              if (part.type === "tool-call") return `[tool call: ${part.toolName}] ${safeJsonStringify(compactUnknown(part.input))}`;
              if (part.type === "tool-result") return `[tool result: ${part.toolName}] ${safeJsonStringify(compactToolOutput(part.output, TOOL_OUTPUT_PREVIEW_CHARS))}`;
              return `[${part.type}]`;
            }).join("\n");
        return `${message.role}: ${content}`;
      })
      .join("\n\n"),
    16_000,
  );
}

export function emergencyCompactProviderPrompt(
  prompt: ProviderPrompt,
  attempt: number,
): ProviderPrompt {
  const normalizedAttempt = Math.max(1, attempt);
  const systems = prompt.filter((message) => message.role === "system");
  const conversation = prompt
    .filter((message) => message.role !== "system")
    .map((message) => compactProviderMessage(message, normalizedAttempt));
  const budget = EMERGENCY_TAIL_CHARS[
    Math.min(normalizedAttempt - 1, EMERGENCY_TAIL_CHARS.length - 1)
  ];
  let chars = 0;
  let start = conversation.length;

  for (let index = conversation.length - 1; index >= 0; index--) {
    const messageChars = providerMessageChars(conversation[index]);
    if (chars + messageChars > budget && start < conversation.length) {
      break;
    }
    chars += messageChars;
    if (conversation[index].role !== "tool") {
      start = index;
    }
    if (chars >= budget && start < conversation.length) {
      break;
    }
  }

  const head = conversation.slice(0, start);
  const checkpoint = {
    role: "user" as const,
    content: [{
      type: "text" as const,
      text: `<context-overflow-recovery>\nThe provider rejected the previous prompt for exceeding its context window. Earlier history was compressed automatically. Continue the current task from the retained messages.\n\n${serializeProviderHead(head)}\n</context-overflow-recovery>`,
    }],
  };

  return [...systems, checkpoint, ...conversation.slice(start)];
}

function streamContainsModelOutput(type: string) {
  return [
    "text-start",
    "text-delta",
    "reasoning-start",
    "reasoning-delta",
    "tool-input-start",
    "tool-input-delta",
    "tool-call",
    "file",
    "source",
  ].includes(type);
}

function withStreamOverflowRecovery(
  initial: ProviderStreamResult,
  initialAttempt: number,
  retry: (attempt: number) => Promise<ProviderStreamResult>,
): ProviderStreamResult {
  return {
    ...initial,
    stream: new ReadableStream({
      async start(controller) {
        let current = initial;
        let attempt = initialAttempt;

        while (true) {
          const reader = current.stream.getReader();
          const buffered = [];
          let emittedOutput = false;
          let shouldRetry = false;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                for (const chunk of buffered) controller.enqueue(chunk);
                controller.close();
                return;
              }

              if (value.type === "error" && !emittedOutput && attempt < EMERGENCY_TAIL_CHARS.length && isContextOverflowError(value.error)) {
                shouldRetry = true;
                break;
              }

              if (!emittedOutput && streamContainsModelOutput(value.type)) {
                emittedOutput = true;
                for (const chunk of buffered) controller.enqueue(chunk);
              }
              if (emittedOutput || value.type === "error") {
                controller.enqueue(value);
              } else {
                buffered.push(value);
              }
            }
          } catch (error) {
            if (!emittedOutput && attempt < EMERGENCY_TAIL_CHARS.length && isContextOverflowError(error)) {
              shouldRetry = true;
            } else {
              controller.error(error);
              return;
            }
          } finally {
            reader.releaseLock();
          }

          if (!shouldRetry) {
            controller.close();
            return;
          }

          while (true) {
            attempt += 1;
            console.warn(`Provider context overflow detected; retrying with emergency compaction (attempt ${attempt})`);
            try {
              current = await retry(attempt);
              break;
            } catch (error) {
              if (attempt >= EMERGENCY_TAIL_CHARS.length || !isContextOverflowError(error)) {
                controller.error(error);
                return;
              }
            }
          }
        }
      },
    }),
  };
}

/** Converts provider context overflows into progressively more aggressive retries. */
export function createContextOverflowRecoveryMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapStream: async ({ doStream, model, params }) => {
      const retry = async (attempt: number) => model.doStream({
        ...params,
        prompt: emergencyCompactProviderPrompt(params.prompt, attempt),
      });
      let attempt = 0;
      let result: ProviderStreamResult;

      while (true) {
        try {
          result = attempt === 0 ? await doStream() : await retry(attempt);
          break;
        } catch (error) {
          if (attempt >= EMERGENCY_TAIL_CHARS.length || !isContextOverflowError(error)) {
            throw error;
          }
          attempt += 1;
          console.warn(`Provider context overflow detected; retrying with emergency compaction (attempt ${attempt})`);
        }
      }

      return withStreamOverflowRecovery(result, attempt, retry);
    },
  };
}
