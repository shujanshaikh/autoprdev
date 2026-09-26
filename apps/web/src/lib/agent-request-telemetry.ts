import { createHash, randomUUID } from "node:crypto";
import type { LanguageModelMiddleware } from "ai";
import { CODEX_MODELS, calculateCodexUsageCost } from "./codex-models";

type StreamOptions = Parameters<NonNullable<LanguageModelMiddleware["wrapStream"]>>[0];
type Request = StreamOptions["params"];
type StreamResult = Awaited<ReturnType<StreamOptions["doStream"]>>;
type Chunk = StreamResult["stream"] extends ReadableStream<infer T> ? T : never;
type Usage = Extract<Chunk, { type: "finish" }>["usage"];

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value) ?? "").digest("hex");
}

/** Sizes describe SDK-rendered sections, not tokenizer counts or billed source shares. */
export function profileAgentRequest(params: Request) {
  const sourceChars: Record<string, number> = {};
  let reasoningParts = 0;
  let reasoningPartsWithoutProviderOptions = 0;
  let reasoningPartsWithoutEncryptedContent = 0;
  const add = (source: string, value: unknown) => {
    sourceChars[source] = (sourceChars[source] ?? 0) + (JSON.stringify(value)?.length ?? 0);
  };
  add("tools", params.tools ?? []);
  if (params.providerOptions?.openai?.instructions) add("system", params.providerOptions.openai.instructions);
  for (const message of params.prompt) {
    if (message.role === "system") {
      add("system", message.content);
      continue;
    }
    for (const part of message.content) {
      if (part.type === "reasoning") {
        reasoningParts += 1;
        if (!part.providerOptions) reasoningPartsWithoutProviderOptions += 1;
        if (!part.providerOptions?.openai?.reasoningEncryptedContent) reasoningPartsWithoutEncryptedContent += 1;
      }
      if (part.type === "tool-result") {
        const source = part.toolName === "read" ? "fileReads"
          : ["grep", "find", "ls"].includes(part.toolName) ? "searchResults"
          : part.toolName === "sub-agent" ? "subagents" : "toolOutput";
        add(source, part);
      } else if (part.type === "text" && message.role === "user") {
        // Setup and repository guidance share one user message. Keep their sizes
        // separate so repository rules do not hide the changing environment.
        const projectStart = part.text.indexOf('<project_context trust=');
        if (projectStart >= 0) {
          add("setup", part.text.slice(0, projectStart));
          add("repositoryRules", part.text.slice(projectStart));
        } else {
          add(part.text.startsWith("Current date:") ? "setup"
            : part.text.startsWith("<context-checkpoint>") || part.text.startsWith("<context-overflow-recovery>")
              ? "summaries" : "user", part);
        }
      } else {
        add("history", part);
      }
    }
  }
  return {
    sourceChars,
    reasoningParts,
    reasoningPartsWithoutProviderOptions,
    reasoningPartsWithoutEncryptedContent,
    staticChars: (sourceChars.tools ?? 0) + (sourceChars.system ?? 0),
    toolsHash: fingerprint(params.tools ?? []),
    systemHash: fingerprint([
      params.providerOptions?.openai?.instructions,
      params.prompt.filter((message) => message.role === "system"),
    ]),
    promptHash: fingerprint(params.prompt),
    toolNames: params.tools?.map((tool) => tool.name) ?? [],
  };
}

export function requestUsage(usage: Usage, modelId: string) {
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const rates = CODEX_MODELS.find((model) => model.id === modelId)?.cost;
  const complete = input.total !== undefined && input.cacheRead !== undefined && output.total !== undefined;
  return {
    inputTokens: input.total ?? null,
    uncachedInputTokens: input.noCache ?? null,
    cachedInputTokens: input.cacheRead ?? null,
    cacheWriteTokens: input.cacheWrite ?? null,
    outputTokens: output.total ?? null,
    reasoningTokens: output.reasoning ?? null,
    cacheHit: input.cacheRead === undefined ? null : input.cacheRead > 0,
    // Subscription transports do not expose a dollar bill. Unknown prices stay unknown.
    apiEquivalentCost: rates && complete && input.total! <= 272_000 && !input.cacheWrite
      ? calculateCodexUsageCost(modelId, {
          inputTokens: input.total!, cachedInputTokens: input.cacheRead!,
          cacheWriteTokens: 0, outputTokens: output.total!,
        }) : null,
  };
}

/** Logs metadata only. Wrap inside overflow recovery so every retry is visible. */
export function createAgentRequestTelemetry(options: {
  threadId?: string;
  turnId: string;
  role: "parent" | "subagent";
  emit?: (event: Record<string, unknown>) => void;
}): LanguageModelMiddleware {
  const emit = (event: Record<string, unknown>) => {
    try {
      (options.emit ?? ((record) => console.info(JSON.stringify(record))))(event);
    } catch {
      // Observability must not interrupt generation.
    }
  };
  return {
    specificationVersion: "v3",
    wrapStream: async ({ params, model, doStream }) => {
      const requestId = randomUUID();
      const startedAt = Date.now();
      const base = {
        event: "agent_request", threadId: options.threadId, turnId: options.turnId,
        requestId, role: options.role, promptVariant: process.env.AUTOPR_COMPACT_TOOL_PROMPT === "1" ? "compact-tools" : "baseline", modelId: model.modelId, provider: model.provider,
        readOutputVariant: process.env.AUTOPR_SPARSE_READ_LINES === "1" ? "sparse-lines" : "baseline",
        purpose: params.prompt.some((message) => message.role === "system"
          && message.content.startsWith("You create context checkpoints")) ? "compaction" : "task",
        ...profileAgentRequest(params),
      };
      emit({ ...base, status: "started" });
      if (model.provider.startsWith("openai") && base.reasoningPartsWithoutEncryptedContent > 0) {
        emit({ event: "agent_reasoning_warning", threadId: options.threadId, turnId: options.turnId,
          requestId, modelId: model.modelId, missingEncryptedParts: base.reasoningPartsWithoutEncryptedContent });
      }
      try {
        const result = await doStream();
        const reader = result.stream.getReader();
        let finished = false;
        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              try {
                const { value, done } = await reader.read();
                if (done) {
                  if (!finished) emit({ ...base, status: "missing_usage" });
                  controller.close();
                  reader.releaseLock();
                  return;
                }
                if (value.type === "finish") {
                  finished = true;
                  emit({ ...base, status: "finished", durationMs: Date.now() - startedAt,
                    finishReason: value.finishReason, ...requestUsage(value.usage, model.modelId) });
                } else if (value.type === "error") {
                  emit({ ...base, status: "provider_error" });
                }
                controller.enqueue(value);
              } catch (error) {
                emit({ ...base, status: params.abortSignal?.aborted ? "aborted" : "stream_error" });
                controller.error(error);
                reader.releaseLock();
              }
            },
            async cancel(reason) {
              emit({ ...base, status: "cancelled" });
              await reader.cancel(reason);
              reader.releaseLock();
            },
          }),
        };
      } catch (error) {
        emit({ ...base, status: params.abortSignal?.aborted ? "aborted" : "provider_error" });
        throw error;
      }
    },
  };
}

export function logAgentToolStep(
  step: import("ai").StepResult<import("ai").ToolSet>,
  context: { threadId?: string; turnId: string; role: "parent" | "subagent" },
) {
  for (const call of step.toolCalls) {
    const failure = step.content.find((part) => part.type === "tool-error" && part.toolCallId === call.toolCallId);
    const error = failure?.type === "tool-error" ? failure.error : undefined;
    const name = error instanceof Error ? error.name : undefined;
    const category = !failure ? null
      : name === "AbortError" ? "user_abort"
      : name === "TimeoutError" ? "timeout"
      : name === "AI_InvalidToolInputError" || name === "AI_NoSuchToolError" ? "invalid_arguments"
      : "unknown";
    console.info(JSON.stringify({ event: "agent_tool", ...context,
      modelId: step.model.modelId, toolName: call.toolName, toolCallId: call.toolCallId,
      errorCategory: category }));
  }
}
