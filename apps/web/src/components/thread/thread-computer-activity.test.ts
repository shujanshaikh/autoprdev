import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  activeComputerToolCallId,
  latestComputerToolCallId,
} from "./thread-computer-activity";

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return { id: "assistant-1", role: "assistant", parts };
}

describe("activeComputerToolCallId", () => {
  it("detects a streaming dynamic computer tool", () => {
    const message = assistantMessage([{
      type: "dynamic-tool",
      toolName: "computer",
      toolCallId: "computer-1",
      state: "input-available",
      input: { actions: [{ type: "screenshot" }] },
    }]);

    expect(activeComputerToolCallId(message)).toBe("computer-1");
  });

  it("ignores completed computer tools and other active tools", () => {
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

    expect(activeComputerToolCallId(message)).toBeUndefined();
    expect(latestComputerToolCallId(message)).toBe("computer-complete");
  });

  it("ignores computer parts in user messages", () => {
    const message = {
      id: "user-1",
      role: "user" as const,
      parts: [{
        type: "dynamic-tool",
        toolName: "computer",
        toolCallId: "computer-1",
        state: "input-available",
        input: {},
      }],
    } satisfies UIMessage;

    expect(activeComputerToolCallId(message)).toBeUndefined();
    expect(latestComputerToolCallId(message)).toBeUndefined();
  });
});
