import { wrapLanguageModel, type LanguageModel, type ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  createAgentContextCompactor,
  createContextOverflowRecoveryMiddleware,
  emergencyCompactProviderPrompt,
  estimateModelMessagesTokens,
  isContextOverflowError,
} from "./agent-context-compaction";

describe("agent context compaction", () => {
  it("creates a checkpoint and retains a coherent recent tail before the hard limit", async () => {
    const messages: ModelMessage[] = [
      { role: "user", content: `Initial request\n${"a".repeat(70_000)}` },
      { role: "assistant", content: `Earlier progress\n${"b".repeat(50_000)}` },
      { role: "user", content: "Continue the implementation and run the focused tests." },
    ];
    const summarize = vi.fn(async () => "## Goal\nFinish the implementation.\n\n## Next Steps\nRun tests.");
    const prepareStep = createAgentContextCompactor({
      contextWindow: 32_000,
      summarize,
    });

    const result = await prepareStep({
      messages,
      model: "test-model" as LanguageModel,
      steps: [],
      stepNumber: 0,
      experimental_context: undefined,
    });

    expect(result?.messages?.[0]).toMatchObject({ role: "user" });
    expect(String(result?.messages?.[0]?.content)).toContain("<context-checkpoint>");
    expect(result?.messages?.at(-1)).toEqual(messages.at(-1));
    expect(JSON.stringify(result?.messages)).not.toContain("a".repeat(10_000));
    expect(summarize).toHaveBeenCalled();
    const summaryCalls = summarize.mock.calls.length;
    expect(estimateModelMessagesTokens(result?.messages ?? [])).toBeLessThan(
      estimateModelMessagesTokens(messages),
    );

    const nextMessages: ModelMessage[] = [
      ...messages,
      { role: "assistant", content: "I will run the tests now." },
    ];
    const nextResult = await prepareStep({
      messages: nextMessages,
      model: "test-model" as LanguageModel,
      steps: [],
      stepNumber: 1,
      experimental_context: undefined,
    });

    expect(String(nextResult?.messages?.[0]?.content)).toContain("Finish the implementation");
    expect(nextResult?.messages?.at(-1)).toEqual(nextMessages.at(-1));
    expect(summarize).toHaveBeenCalledTimes(summaryCalls);
  });

  it("recognizes nested provider overflow errors", () => {
    expect(
      isContextOverflowError({
        error: {
          type: "invalid_request_error",
          code: "context_length_exceeded",
          message: "Your input exceeds the context window of this model.",
        },
      }),
    ).toBe(true);
    expect(isContextOverflowError(new Error("The provider is temporarily unavailable"))).toBe(false);
  });

  it("falls back to a deterministic checkpoint when summarization fails", async () => {
    const prepareStep = createAgentContextCompactor({
      contextWindow: 32_000,
      summarize: async () => {
        throw new Error("summary model unavailable");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const messages: ModelMessage[] = [
      { role: "user", content: `Preserve this request ${"x".repeat(110_000)}` },
      { role: "assistant", content: "Work completed so far" },
      { role: "user", content: "Continue" },
    ];

    const result = await prepareStep({
      messages,
      model: "test-model" as LanguageModel,
      steps: [],
      stepNumber: 0,
      experimental_context: undefined,
    });

    expect(JSON.stringify(result?.messages?.[0])).toContain("Recovery Note");
    expect(result?.messages?.at(-1)).toEqual(messages.at(-1));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("preserves system instructions and the latest work during emergency compaction", () => {
    const prompt = [
      { role: "system" as const, content: "You are a coding agent." },
      { role: "user" as const, content: [{ type: "text" as const, text: "x".repeat(100_000) }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Earlier work" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "Keep going" }] },
    ];

    const compacted = emergencyCompactProviderPrompt(prompt, 2);

    expect(compacted[0]).toEqual(prompt[0]);
    expect(compacted.some((message) =>
      message.role !== "system"
      && message.content.some((part) => part.type === "text" && part.text.includes("context-overflow-recovery")),
    )).toBe(true);
    expect(JSON.stringify(compacted)).toContain("Keep going");
    expect(JSON.stringify(compacted).length).toBeLessThan(JSON.stringify(prompt).length);
  });

  it("retries the provider request after a context overflow", async () => {
    type ProviderModel = Parameters<typeof wrapLanguageModel>[0]["model"];
    const prompts: unknown[] = [];
    const model: ProviderModel = {
      specificationVersion: "v3",
      provider: "test-provider",
      modelId: "test-model",
      supportedUrls: {},
      async doGenerate() {
        throw new Error("not used");
      },
      async doStream(params) {
        prompts.push(params.prompt);
        if (prompts.length === 1) {
          throw {
            error: {
              code: "context_length_exceeded",
              message: "Your input exceeds the context window of this model.",
            },
          };
        }

        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ type: "text-start", id: "text-1" });
              controller.enqueue({ type: "text-delta", id: "text-1", delta: "continued" });
              controller.enqueue({ type: "text-end", id: "text-1" });
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              });
              controller.close();
            },
          }),
        };
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const wrapped = wrapLanguageModel({
      model,
      middleware: createContextOverflowRecoveryMiddleware(),
    });

    const result = await wrapped.doStream({
      prompt: [
        { role: "system", content: "System instructions" },
        { role: "user", content: [{ type: "text", text: "large request" }] },
      ],
    });
    const chunks = [];
    const reader = result.stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[1])).toContain("context-overflow-recovery");
    expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.delta === "continued")).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
