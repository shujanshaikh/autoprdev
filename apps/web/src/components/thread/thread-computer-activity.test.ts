import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  activeThreadComputerToolCallId,
  latestComputerToolCallId,
} from "./thread-computer-activity";

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return { id: "assistant-1", role: "assistant", parts };
}

describe("computer tool activity", () => {
  it("finds the latest computer tool and ignores other tools", () => {
    const message = assistantMessage([
      {
        type: "dynamic-tool",
        toolName: "computer",
        toolCallId: "computer-complete",
        state: "output-available",
        input: { actions: [{ type: "screenshot" }] },
        output: { content: "done", details: {} },
      },
      {
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "bash-1",
        state: "input-streaming",
        input: { command: "pnpm test" },
      },
    ]);

    expect(latestComputerToolCallId(message)).toBe("computer-complete");
  });

  it("ignores computer parts in user messages", () => {
    const message = {
      id: "user-1",
      role: "user",
      parts: [{
        type: "dynamic-tool",
        toolName: "computer",
        toolCallId: "computer-1",
        state: "input-available",
        input: {},
      }],
    } as UIMessage;

    expect(latestComputerToolCallId(message)).toBeUndefined();
  });

  it("does not revive a completed computer call when a thread is reopened", () => {
    const computerMessage = assistantMessage([{
      type: "dynamic-tool",
      toolName: "computer",
      toolCallId: "computer-existing",
      state: "output-available",
      input: { actions: [{ type: "screenshot" }] },
      output: { content: "done", details: {} },
    }]);
    const userMessage = {
      id: "user-follow-up",
      role: "user",
      parts: [{ type: "text", text: "Open another tab" }],
    } satisfies UIMessage;
    const nextAssistantMessage = {
      id: "assistant-next",
      role: "assistant",
      parts: [{ type: "text", text: "I will open it." }],
    } satisfies UIMessage;

    expect(activeThreadComputerToolCallId([
      computerMessage,
      userMessage,
      nextAssistantMessage,
    ], undefined)).toBeUndefined();
    expect(activeThreadComputerToolCallId([
      computerMessage,
      userMessage,
      nextAssistantMessage,
    ], nextAssistantMessage.id)).toBeUndefined();
  });

  it("tracks computer use only in the currently running assistant turn", () => {
    const firstMessage = assistantMessage([{
      type: "dynamic-tool",
      toolName: "computer",
      toolCallId: "computer-first",
      state: "output-available",
      input: {},
      output: { content: "done", details: {} },
    }]);
    const secondMessage = {
      ...assistantMessage([{
        type: "dynamic-tool",
        toolName: "computer",
        toolCallId: "computer-second",
        state: "input-available",
        input: {},
      }]),
      id: "assistant-2",
    };

    expect(activeThreadComputerToolCallId(
      [firstMessage],
      firstMessage.id,
    )).toBe("computer-first");
    expect(activeThreadComputerToolCallId(
      [firstMessage, secondMessage],
      secondMessage.id,
    )).toBe("computer-second");
    expect(activeThreadComputerToolCallId(
      [firstMessage, secondMessage],
      undefined,
    )).toBeUndefined();
  });
});
