import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { latestSubAgentActivity } from "./thread-sub-agent-activity";

describe("latestSubAgentActivity", () => {
  it("maps parallel sub-agent tool calls from the latest assistant turn", () => {
    const messages = [{
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-sub-agent",
          toolCallId: "call-1",
          state: "input-available",
          input: { description: "Inspect auth" },
        },
        {
          type: "tool-sub-agent",
          toolCallId: "call-2",
          state: "output-available",
          input: { description: "Review tests" },
          output: { content: "done" },
        },
      ],
    }] as UIMessage[];

    expect(latestSubAgentActivity(messages)).toEqual({
      messageId: "assistant-1",
      tasks: [
        { id: "call-1", description: "Inspect auth", status: "running" },
        { id: "call-2", description: "Review tests", status: "completed" },
      ],
    });
  });

  it("ignores older turns and reports failed child calls", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "tool-sub-agent",
          toolCallId: "old-call",
          state: "output-available",
          input: { description: "Old task" },
          output: { content: "done" },
        }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Try again" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{
          type: "tool-sub-agent",
          toolCallId: "failed-call",
          state: "output-error",
          input: { description: "Check build" },
          errorText: "failed",
        }],
      },
    ] as UIMessage[];

    expect(latestSubAgentActivity(messages)).toEqual({
      messageId: "assistant-2",
      tasks: [{ id: "failed-call", description: "Check build", status: "failed" }],
    });
  });

  it("hides the surface when the latest assistant turn did not delegate", () => {
    const messages = [{
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "No delegation needed." }],
    }] as UIMessage[];

    expect(latestSubAgentActivity(messages)).toBeUndefined();
  });
});
