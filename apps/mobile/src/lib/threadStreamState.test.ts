import { describe, expect, it } from "vitest";

import { mergePersistedAssistantParts, reconcileThreadMessages, type ThreadDisplayMessage } from "./threadStreamState";

const user = (messageId: string): ThreadDisplayMessage => ({
  messageId,
  role: "user",
  parts: [{ type: "text", text: messageId }],
});

const assistant = (parts: unknown[]): ThreadDisplayMessage => ({
  messageId: "assistant-1",
  role: "assistant",
  parts,
});

describe("mergePersistedAssistantParts", () => {
  it("keeps live output while the persisted assistant is still empty", () => {
    const streaming = [{ type: "text", text: "Still working", state: "streaming" }];
    expect(mergePersistedAssistantParts(streaming, [])).toBe(streaming);
  });

  it("adopts a completed persisted text part", () => {
    const persisted = [{ type: "text", text: "Finished response", state: "done" }];
    expect(mergePersistedAssistantParts(
      [{ type: "text", text: "Finished", state: "streaming" }],
      persisted,
    )).toBe(persisted);
  });

  it("adopts terminal persisted tool output by tool-call ID", () => {
    const persisted = [{
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: "tool-1",
      state: "output-available",
      output: "done",
    }];
    expect(mergePersistedAssistantParts(
      [{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "tool-1",
        state: "input-available",
      }],
      persisted,
    )).toBe(persisted);
  });

  it("removes dangling streamed tools after a run settles", () => {
    const persisted = [{ type: "text", text: "Stopped", state: "done" }];
    expect(mergePersistedAssistantParts(
      [
        ...persisted,
        { type: "dynamic-tool", toolCallId: "tool-1", state: "input-available" },
      ],
      persisted,
      { allowPersistedRemoval: true },
    )).toBe(persisted);
  });
});

describe("reconcileThreadMessages", () => {
  it("deduplicates an optimistic user message once it persists", () => {
    const persisted = [user("user-1")];
    expect(reconcileThreadMessages({
      persistedMessages: persisted,
      optimisticUserMessage: user("user-1"),
      streamingAssistantMessage: null,
      allowPersistedPartRemoval: false,
    })).toEqual(persisted);
  });

  it("merges a live assistant into its persisted placeholder", () => {
    const persistedAssistant = { ...assistant([]), metadata: { saved: true } };
    const streamingAssistant = assistant([
      { type: "reasoning", text: "Inspecting", state: "streaming" },
    ]);
    const result = reconcileThreadMessages({
      persistedMessages: [user("user-1"), persistedAssistant],
      optimisticUserMessage: null,
      streamingAssistantMessage: streamingAssistant,
      allowPersistedPartRemoval: false,
    });

    expect(result).toHaveLength(2);
    expect(result[1]?.parts).toEqual(streamingAssistant.parts);
    expect(result[1]?.metadata).toEqual({ saved: true });
  });
});
