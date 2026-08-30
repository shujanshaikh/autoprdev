import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  agentProviderOptions: vi.fn(() => ({ openai: { store: false } })),
  harnessOptions: [] as Array<Record<string, unknown>>,
  withSandboxAgentProjectContext: vi.fn((messages: unknown) => messages),
}));

vi.mock("@autopr/agent", () => ({
  applyAgenticCache: (messages: unknown) => messages,
  CodingHarness: class {
    constructor(options: Record<string, unknown>) {
      mocks.harnessOptions.push(options);
    }

    run<T>(execute: (context: Record<string, unknown>) => Promise<T>) {
      return execute({
        instructions: "child instructions",
        repositoryContext: "repository context",
        tools: { read: { description: "read" } },
      });
    }
  },
  createAgentStepController: (options: unknown) => options,
  withSandboxAgentProjectContext: mocks.withSandboxAgentProjectContext,
}));

vi.mock("ai", () => ({
  streamText: mocks.streamText,
  stepCountIs: (count: number) => ({ count }),
}));

vi.mock("#/lib/agent-context-compaction", () => ({
  createAgentContextCompactor: (options: unknown) => options,
}));

vi.mock("#/lib/agent-auth-runtime-server", () => ({
  agentProviderOptions: mocks.agentProviderOptions,
  agentSystemPrompt: (_model: unknown, instructions: string) => instructions,
}));

vi.mock("#/lib/agent-models", () => ({
  getAgentContextLimit: () => 100_000,
}));

import {
  createAgentSubAgentRunner,
  createSubAgentBinding,
} from "./agent-sub-agent";

describe("agent sub-agent runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.harnessOptions.length = 0;
  });

  it("fails closed until the parent model runner is bound", async () => {
    const binding = createSubAgentBinding();
    const task = { description: "Inspect parser", prompt: "Inspect parser.ts" };

    await expect(binding.run(task)).rejects.toThrow("before the parent agent runtime was ready");

    const run = vi.fn().mockResolvedValue({ output: "done", stepCount: 1 });
    binding.bind(run);

    await expect(binding.run(task)).resolves.toEqual({ output: "done", stepCount: 1 });
    expect(run).toHaveBeenCalledWith(task);
  });

  it("streams a fresh child run without recursive delegation and reports usage", async () => {
    const usageStep = {
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    };
    mocks.streamText.mockImplementation((options: {
      onStepFinish?: (step: typeof usageStep) => void;
    }) => {
      return {
        text: Promise.resolve().then(() => {
          options.onStepFinish?.(usageStep);
          return "  Child result  ";
        }),
      };
    });
    const onUsageStep = vi.fn();
    const childModel = {} as LanguageModel;
    const selectedModel = {
      provider: "openai-codex" as const,
      modelId: "gpt-5.6-sol",
      reasoningEffort: "high",
      credentialsGrantId: "grant-1",
      credentialsGrantContext: {
        userId: "user-1",
        taskId: "autopr-agent" as const,
        contextId: "thread-1",
      },
    };
    const runner = createAgentSubAgentRunner({
      sandboxOptions: {
        cacheKey: "sandbox-key",
        sandboxId: "sandbox-1",
        workDir: "/workspace/repo",
      },
      model: childModel,
      selectedModel,
      onUsageStep,
    });

    await expect(runner({
      description: "Inspect parser",
      prompt: "Inspect parser.ts and report the issue.",
    })).resolves.toEqual({ output: "Child result", stepCount: 1 });

    expect(mocks.harnessOptions[0]).toMatchObject({
      sandboxId: "sandbox-1",
      workDir: "/workspace/repo",
      computer: false,
      selectedTools: ["sandboxInfo", "read", "ls", "find", "grep", "bash", "process"],
      modelId: "gpt-5.6-sol",
    });
    expect(mocks.harnessOptions[0]).not.toHaveProperty("subAgent");
    expect(mocks.withSandboxAgentProjectContext).toHaveBeenCalledWith(
      [{ role: "user", content: "Inspect parser.ts and report the issue." }],
      "repository context",
    );
    expect(onUsageStep).toHaveBeenCalledWith(usageStep);
    expect(mocks.streamText).toHaveBeenCalledWith(expect.objectContaining({
      model: childModel,
      providerOptions: { openai: { store: false } },
    }));
    expect(mocks.agentProviderOptions).toHaveBeenCalledWith(
      selectedModel,
      "child instructions",
    );
  });
});
