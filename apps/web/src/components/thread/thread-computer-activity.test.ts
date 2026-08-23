import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  activeThreadComputerActivityKey,
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

    expect(activeThreadComputerActivityKey([
      computerMessage,
      userMessage,
      nextAssistantMessage,
    ], undefined)).toBeUndefined();
    expect(activeThreadComputerActivityKey([
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

    expect(activeThreadComputerActivityKey(
      [firstMessage],
      firstMessage.id,
    )).toBe(firstMessage.id);
    expect(activeThreadComputerActivityKey(
      [firstMessage, secondMessage],
      secondMessage.id,
    )).toBe(secondMessage.id);
    expect(activeThreadComputerActivityKey(
      [firstMessage, secondMessage],
      undefined,
    )).toBeUndefined();
  });

  it("keeps one activity key across multiple computer calls in the same turn", () => {
    const firstCall = assistantMessage([{
      type: "dynamic-tool",
      toolName: "computer",
      toolCallId: "computer-first",
      state: "output-available",
      input: {},
      output: { content: "done", details: {} },
    }]);
    const secondCall = {
      ...firstCall,
      parts: [
        ...firstCall.parts,
        {
          type: "dynamic-tool" as const,
          toolName: "computer",
          toolCallId: "computer-second",
          state: "input-available" as const,
          input: {},
        },
      ],
    } satisfies UIMessage;

    expect(activeThreadComputerActivityKey([firstCall], firstCall.id))
      .toBe(firstCall.id);
    expect(activeThreadComputerActivityKey([secondCall], secondCall.id))
      .toBe(firstCall.id);
  });
});
