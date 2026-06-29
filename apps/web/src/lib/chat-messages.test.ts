import { describe, expect, it } from "vitest";

import {
  COMPUTER_METADATA_PREFIX,
  findDemoRecordingMetadataInParts,
  mergePersistedAssistantParts,
  sanitizeAssistantPartsForPersistence,
  sanitizeMessageForModelConversion,
} from "./chat-messages";
import { compactPromptMessagesForModel } from "./agent-message-compaction";

describe("chat message persistence helpers", () => {
  it("strips computer screenshot payloads while preserving metadata and recordings", () => {
    const screenshotPayload = "a".repeat(1_500);
    const parts = [
      {
        type: "dynamic-tool",
        toolName: "computer",
        toolCallId: "tool-1",
        state: "output-available",
        input: { action: "screenshot" },
        output: {
          content: "Captured desktop screenshot.",
          details: {
            action: "screenshot",
            screenshot: {
              data: screenshotPayload,
              sizeBytes: 900,
              format: "jpeg",
            },
            recording: {
              type: "daytona_recording",
              id: "rec-123",
              title: "Signup Vault Setup Demo",
              fileName: "demo.mp4",
              url: "/api/project/p/thread/t?recordingId=rec-123",
            },
          },
        },
      },
    ] as any;

    const sanitized = sanitizeAssistantPartsForPersistence(parts);
    const output = (sanitized[0] as any).output;

    expect(output.details.screenshot.data).toEqual({
      omitted: true,
      base64Length: screenshotPayload.length,
    });
    expect(output.details.screenshot.sizeBytes).toBe(900);
    expect(output.details.screenshot.payloadStripped).toBe(true);
    expect(output.details.recording).toEqual({
      type: "daytona_recording",
      id: "rec-123",
      title: "Signup Vault Setup Demo",
      fileName: "demo.mp4",
      url: "/api/project/p/thread/t?recordingId=rec-123",
    });
    expect(findDemoRecordingMetadataInParts(sanitized, "rec-123")?.fileName).toBe("demo.mp4");
  });

  it("leaves non-computer tool payloads unchanged", () => {
    const parts = [
      {
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "tool-1",
        state: "output-available",
        input: { command: "echo ok" },
        output: { screenshot: "a".repeat(1_500) },
      },
    ] as any;

    expect(sanitizeAssistantPartsForPersistence(parts)).toEqual(parts);
  });

  it("uses completed persisted assistant parts over stale live parts", () => {
    const currentParts = [
      {
        type: "text",
        text: "I'll inspect the repository status.",
      },
    ] as any;
    const persistedParts = [
      {
        type: "text",
        text: "I'll inspect the repository status.\n\nLatest changes on main: fixed the UI.",
      },
    ] as any;

    expect(
      mergePersistedAssistantParts(currentParts, persistedParts, {
        allowPersistedRemoval: true,
      }),
    ).toBe(persistedParts);
  });

  it("keeps newer streaming assistant text over shorter persisted parts", () => {
    const currentParts = [
      {
        type: "text",
        state: "streaming",
        text: "I'll inspect the repository status and keep streaming details.",
      },
    ] as any;
    const persistedParts = [
      {
        type: "text",
        text: "I'll inspect the repository status.",
      },
    ] as any;

    expect(
      mergePersistedAssistantParts(currentParts, persistedParts, {
        allowPersistedRemoval: true,
      }),
    ).toBe(currentParts);
  });

  it("uses longer persisted assistant text even when live text is still marked streaming", () => {
    const currentParts = [
      {
        type: "text",
        state: "streaming",
        text: "I'll inspect the repository status.",
      },
    ] as any;
    const persistedParts = [
      {
        type: "text",
        text: "I'll inspect the repository status.\n\nLatest changes on main: fixed the UI.",
      },
    ] as any;

    expect(
      mergePersistedAssistantParts(currentParts, persistedParts, {
        allowPersistedRemoval: true,
      }),
    ).toBe(persistedParts);
  });

  it("normalizes multimodal computer content before persistence", () => {
    const screenshotPayload = "b".repeat(1_500);
    const metadata = {
      action: "screenshot",
      screenshot: {
        mimeType: "image/png",
        sizeBytes: 1200,
      },
      recording: {
        type: "daytona_recording",
        id: "rec-456",
        title: "Gallery Walkthrough",
        fileName: "flow.mp4",
      },
    };
    const parts = [
      {
        type: "dynamic-tool",
        toolName: "computer",
        toolCallId: "tool-2",
        state: "output-available",
        input: { actions: [{ type: "screenshot" }] },
        output: [
          { type: "text", text: "Actions: screenshot" },
          { type: "text", text: `${COMPUTER_METADATA_PREFIX}${JSON.stringify(metadata)}` },
          { type: "image-data", mediaType: "image/png", data: screenshotPayload },
        ],
      },
    ] as any;

    const sanitized = sanitizeAssistantPartsForPersistence(parts);
    const output = (sanitized[0] as any).output;

    expect(output.content).toBe("Actions: screenshot");
    expect(output.details.screenshot.data).toEqual({
      omitted: true,
      base64Length: screenshotPayload.length,
    });
    expect(output.details.screenshot.payloadStripped).toBe(true);
    expect(findDemoRecordingMetadataInParts(sanitized, "rec-456")?.title).toBe("Gallery Walkthrough");
  });

  it("compacts long file mutation payloads before model conversion", () => {
    const longContent = "x".repeat(5_000);
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "write",
          toolCallId: "tool-1",
          state: "output-available",
          input: { path: "src/index.ts", content: longContent },
          output: {
            content: "Wrote 5000 bytes to src/index.ts.",
            details: {
              path: "src/index.ts",
              bytesWritten: 5000,
              diff: {
                renderer: "pierre",
                fileName: "src/index.ts",
                patch: longContent,
                oldContent: longContent,
                newContent: longContent,
              },
            },
          },
        },
      ],
    } as any;

    const sanitized = sanitizeMessageForModelConversion(message);
    const part = sanitized.parts[0] as any;

    expect(part.input.content).toContain("write.content omitted from model prompt");
    expect(part.input.content.length).toBeLessThan(700);
    expect(part.output.details.diff.patch).toBe("[diff omitted from model prompt; rendered in the UI]");
    expect(part.output.details.diff.oldContentOmitted).toBe(true);
    expect(part.output.details.diff.newContentOmitted).toBe(true);
    expect(part.output.details.diff.patchChars).toBe(5_000);
  });

  it("compacts in-flight workflow prompt tool history", () => {
    const longText = "y".repeat(5_000);
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolName: "edit",
            toolCallId: "tool-1",
            input: {
              path: "src/index.ts",
              edits: [{ oldText: longText, newText: longText }],
            },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "edit",
            toolCallId: "tool-1",
            output: {
              type: "json",
              value: {
                content: "Applied 1 exact replacement(s) to src/index.ts.",
                details: {
                  path: "src/index.ts",
                  replacements: 1,
                  diff: {
                    renderer: "pierre",
                    fileName: "src/index.ts",
                    patch: longText,
                  },
                },
              },
            },
          },
        ],
      },
    ];

    const compacted = compactPromptMessagesForModel(messages) as any;
    const toolCall = compacted[0].content[0];
    const toolResult = compacted[1].content[0];

    expect(toolCall.input.edits[0].oldText).toContain("edit.edits[0].oldText omitted from model prompt");
    expect(toolCall.input.edits[0].newText).toContain("edit.edits[0].newText omitted from model prompt");
    expect(toolResult.output.value.details.diff.patch).toBe(longText);
    expect(toolResult.output.value.details.diff.patchChars).toBe(5_000);
  });
});
