import { describe, expect, it } from "vitest";

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
        usage: {
          inputTokens: 60,
          outputTokens: 15,
          totalTokens: 75,
          inputTokenDetails: { cacheReadTokens: 10 },
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
    expect(metadata.run).toEqual({
      startedAt: 1_000,
      completedAt: 6_000,
      durationSeconds: 5,
    });
  });
});
