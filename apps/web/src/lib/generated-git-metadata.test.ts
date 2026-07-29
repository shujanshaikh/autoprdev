import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createPullRequestFallback,
  generateThreadTitle,
  normalizeGeneratedCommitMessage,
  normalizeGeneratedThreadTitle,
  parseGeneratedMetadata,
} from "./generated-git-metadata";

const { createCodexModel } = vi.hoisted(() => ({ createCodexModel: vi.fn() }));

vi.mock("#/lib/codex-auth-server", () => ({
  createAuthenticatedCodexResponsesModel: createCodexModel,
}));

describe("generated Git metadata", () => {
  it("normalizes concise generated thread titles and bounds fallback prompts", () => {
    expect(normalizeGeneratedThreadTitle('"Improve Git workflow."', "ignored"))
      .toBe("Improve Git workflow");
    expect(normalizeGeneratedThreadTitle(
      "",
      "I want you to improve the pull request body and branch naming behavior for this project",
    )).toBe("improve the pull request body and branch naming");
  });

  it("parses JSON metadata from plain Codex text responses", () => {
    const schema = z.object({ title: z.string() });

    expect(parseGeneratedMetadata(
      '```json\n{"title":"Fix thread titles"}\n```',
      schema,
    )).toEqual({ title: "Fix thread titles" });
    expect(parseGeneratedMetadata(
      'Generated metadata:\n{"title":"Improve branch naming"}\nDone.',
      schema,
    )).toEqual({ title: "Improve branch naming" });
  });

  it("rejects malformed plain-text metadata", () => {
    expect(() => parseGeneratedMetadata("not json", z.object({ title: z.string() })))
      .toThrow("Codex returned invalid generated metadata.");
  });

  it("keeps commit subjects on one safe line", () => {
    expect(normalizeGeneratedCommitMessage("Subject: Improve PR metadata.\nExtra explanation"))
      .toBe("Improve PR metadata");
  });

  it("creates useful PR content without leaking internal thread IDs", () => {
    const pullRequest = createPullRequestFallback({
      headBranch: "autopr/improve-git-workflow",
      commitSummary: "abc1234 Improve Git workflow metadata\ndef5678 Add title generation",
      diffSummary: "3 files changed, 42 insertions(+)",
    });

    expect(pullRequest.title).toBe("Improve Git workflow metadata");
    expect(pullRequest.body).toContain("## Summary");
    expect(pullRequest.body).toContain("- Improve Git workflow metadata");
    expect(pullRequest.body).toContain("## Testing");
    expect(pullRequest.body).not.toContain("AutoPR thread");
  });

  it("streams thread titles because the Codex responses endpoint rejects non-streaming calls", async () => {
    const doGenerate = vi.fn();
    createCodexModel.mockResolvedValue(new MockLanguageModelV3({
      doGenerate,
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: '{"title":"Fix thread title generation"}' },
            { type: "text-end", id: "0" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
            },
          ],
        }),
      }),
    }));

    await expect(generateThreadTitle({
      request: new Request("http://localhost/api/project/project-1/thread/thread-1"),
      projectId: "project-1",
      threadId: "thread-1",
      message: "the thread title generation keeps failing with a bad request",
    })).resolves.toBe("Fix thread title generation");
    expect(doGenerate).not.toHaveBeenCalled();
  });
});
