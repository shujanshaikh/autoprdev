import { describe, expect, it } from "vitest";

import {
  COMPUTER_METADATA_PREFIX,
  findDemoRecordingMetadataInParts,
  sanitizeAssistantPartsForPersistence,
} from "./chat-messages";

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
    expect(findDemoRecordingMetadataInParts(sanitized, "rec-456")?.fileName).toBe("flow.mp4");
  });
});
