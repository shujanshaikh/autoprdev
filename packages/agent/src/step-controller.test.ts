import { describe, expect, it, vi } from "vitest";

import { createAgentStepController, detectRepeatedToolLoop, type ToolLoopStep } from "./step-controller";

function toolStep(options: {
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}) {
  const toolName = options.toolName ?? "bash";
  const toolCallId = crypto.randomUUID();
  const content = options.error
    ? [{ type: "tool-error", toolCallId, toolName, input: options.input, error: options.error }]
    : [{ type: "tool-result", toolCallId, toolName, input: options.input, output: options.output }];
  return {
    toolCalls: [{ type: "tool-call", toolCallId, toolName, input: options.input }],
    toolResults: options.error
      ? []
      : [{ type: "tool-result", toolCallId, toolName, input: options.input, output: options.output }],
    content,
  } satisfies ToolLoopStep;
}

describe("agent step controller", () => {
  it("detects repeated failed calls but not a changed recovery attempt", () => {
    const repeated = Array.from({ length: 3 }, () => toolStep({
      input: { command: "pnpm test" },
      output: { details: { exitCode: 1 } },
    }));

    expect(detectRepeatedToolLoop(repeated)).toEqual({
      kind: "repeated_failure",
      toolNames: ["bash"],
      repetitions: 3,
    });
    expect(detectRepeatedToolLoop([
      ...repeated.slice(0, 2),
      toolStep({ input: { command: "pnpm test -- --runInBand" }, output: { details: { exitCode: 1 } } }),
    ])).toBeUndefined();
  });

  it("treats structured tool detail errors as failures", () => {
    const repeated = Array.from({ length: 3 }, () => toolStep({
      toolName: "find",
      input: { pattern: "agent" },
      output: { content: "search failed", details: { error: "fff unavailable" } },
    }));

    expect(detectRepeatedToolLoop(repeated)).toMatchObject({
      kind: "repeated_failure",
      toolNames: ["find"],
    });
  });

  it("detects unchanged successful results only after the larger threshold", () => {
    const repeated = Array.from({ length: 5 }, () => toolStep({
      toolName: "process",
      input: { action: "poll", sessionId: "autopr-1", commandId: "cmd-1" },
      output: { status: "running", output: "still starting" },
    }));

    expect(detectRepeatedToolLoop(repeated.slice(0, 4))).toBeUndefined();
    expect(detectRepeatedToolLoop(repeated)).toMatchObject({
      kind: "repeated_result",
      repetitions: 5,
    });
  });

  it("preserves compaction output and forces one tool-free recovery step", async () => {
    const compactedMessages = [{ role: "user" as const, content: "checkpoint" }];
    const basePrepare = vi.fn(async () => ({ messages: compactedMessages }));
    const onToolLoopDetected = vi.fn();
    const detectToolLoop = vi.fn(() => ({
      kind: "repeated_failure" as const,
      toolNames: ["bash"],
      repetitions: 3,
    }));
    const prepare = createAgentStepController({
      prepareStep: basePrepare,
      onToolLoopDetected,
      detectToolLoop,
    });
    const result = await prepare({
      messages: [{ role: "user", content: "fix it" }],
      model: /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ "test-model" as never,
      steps: [],
      stepNumber: 3,
      experimental_context: undefined,
    });

    expect(basePrepare).toHaveBeenCalledOnce();
    expect(result?.toolChoice).toBe("none");
    expect(result?.activeTools).toEqual([]);
    expect(result?.messages?.[0]).toEqual(compactedMessages[0]);
    expect(String(result?.messages?.at(-1)?.content)).toContain("repeated_tool_loop");
    expect(onToolLoopDetected).toHaveBeenCalledWith(expect.objectContaining({ kind: "repeated_failure" }));
  });
});
