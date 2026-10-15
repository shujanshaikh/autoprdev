import { describe, expect, it } from "vite-plus/test";

import { createAssistantUsageMetadata } from "./agent-usage";

describe("createAssistantUsageMetadata", () => {
  it("adds sub-agent usage without replacing the parent context usage", () => {
    const metadata = createAssistantUsageMetadata(
      [{
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          inputTokenDetails: { cacheReadTokens: 40 },
        },
      }],
      "gpt-5.5",
      1_000,
      6_000,
      [{
        modelId: "gpt-5.4-mini",
        step: {
          usage: {
            inputTokens: 60,
            outputTokens: 15,
            totalTokens: 75,
            inputTokenDetails: { cacheReadTokens: 10 },
          },
        },
      }],
    );

    expect(metadata.usage).toMatchObject({
      inputTokens: 160,
      outputTokens: 35,
      totalTokens: 195,
      cachedInputTokens: 50,
    });
    expect(metadata.contextUsage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 40,
    });
    expect(metadata.usage.cost.total).toBeCloseTo(0.00102575);
    expect(metadata.run).toEqual({
      startedAt: 1_000,
      completedAt: 6_000,
      durationSeconds: 5,
    });
  });

  it("counts steps, reasoning tokens, and tool calls and errors across the run tree", () => {
    const metadata = createAssistantUsageMetadata(
      [
        {
          usage: { inputTokens: 10, outputTokens: 5, outputTokenDetails: { reasoningTokens: 3 } },
          content: [
            { type: "reasoning" },
            { type: "tool-call", toolName: "read" },
            { type: "tool-call", toolName: "bash" },
            { type: "tool-result", toolName: "read" },
            { type: "tool-error", toolName: "bash" },
          ],
        },
        { usage: { inputTokens: 20, outputTokens: 4 }, content: [{ type: "text" }] },
      ],
      "gpt-5.5",
      0,
      0,
      [{
        modelId: "gpt-5.5",
        step: {
          usage: { inputTokens: 5, outputTokens: 1, outputTokenDetails: { reasoningTokens: 1 } },
          content: [{ type: "tool-call", toolName: "read" }],
        },
      }],
    );

    expect(metadata.steps).toEqual({ parent: 2, subAgent: 1 });
    expect(metadata.usage.reasoningTokens).toBe(4);
    expect(metadata.tools).toEqual({
      read: { calls: 2, errors: 0 },
      bash: { calls: 1, errors: 1 },
    });
  });
});
