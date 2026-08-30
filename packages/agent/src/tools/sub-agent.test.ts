import { describe, expect, it, vi } from "vitest";

import { createSubAgentTool } from "./sub-agent";

const executionOptions = {
  toolCallId: "sub-agent-1",
  messages: [],
};

describe("sub-agent tool", () => {
  it("runs an isolated task and returns a bounded parent-facing result", async () => {
    const abortController = new AbortController();
    const run = vi.fn().mockResolvedValue({
      output: "Changed packages/agent/src/example.ts\nValidation passed.",
      stepCount: 3,
    });
    const subAgent = createSubAgentTool({ run });
    if (!subAgent.execute) throw new Error("sub-agent tool is not executable");

    const result = await subAgent.execute(
      { description: "Update parser", prompt: "Update only the parser implementation." },
      { ...executionOptions, abortSignal: abortController.signal },
    ) as {
      content: string;
      details: Record<string, unknown>;
    };

    expect(run).toHaveBeenCalledWith({
      description: "Update parser",
      prompt: "Update only the parser implementation.",
      abortSignal: abortController.signal,
    });
    expect(result.content).toContain("Sub-agent completed: Update parser");
    expect(result.content).toContain("Validation passed.");
    expect(result.details).toMatchObject({
      description: "Update parser",
      status: "completed",
      stepCount: 3,
      truncated: false,
    });
  });

  it("rejects work above the concurrency limit and releases slots on completion", async () => {
    const releases: Array<() => void> = [];
    const run = vi.fn(() => new Promise<{ output: string; stepCount: number }>((resolve) => {
      releases.push(() => resolve({ output: "done", stepCount: 1 }));
    }));
    const subAgent = createSubAgentTool({ run, maxConcurrent: 2 });
    if (!subAgent.execute) throw new Error("sub-agent tool is not executable");

    const first = subAgent.execute(
      { description: "First", prompt: "First task" },
      { ...executionOptions, toolCallId: "first" },
    );
    const second = subAgent.execute(
      { description: "Second", prompt: "Second task" },
      { ...executionOptions, toolCallId: "second" },
    );
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));

    await expect(subAgent.execute(
      { description: "Third", prompt: "Third task" },
      { ...executionOptions, toolCallId: "third" },
    )).rejects.toThrow("at most 2 concurrent tasks");

    releases.splice(0).forEach((release) => release());
    await Promise.all([first, second]);

    const fourth = subAgent.execute(
      { description: "Fourth", prompt: "Fourth task" },
      { ...executionOptions, toolCallId: "fourth" },
    );
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    releases.splice(0).forEach((release) => release());
    await expect(fourth).resolves.toMatchObject({
      details: { status: "completed" },
    });
  });
});
