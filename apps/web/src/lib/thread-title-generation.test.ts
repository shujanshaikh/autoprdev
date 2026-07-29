import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  firstUserMessageForTitle,
  threadTitleRetryDelayMs,
} from "./thread-title-generation";

describe("thread title generation", () => {
  it("uses the first persisted user text even after the thread remounts", () => {
    const messages = [
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "  Fix title generation using my Codex subscription  " }],
      },
      { id: "user-2", role: "user", parts: [{ type: "text", text: "Ignore this later turn" }] },
    ] satisfies UIMessage[];

    expect(firstUserMessageForTitle(messages)).toBe(
      "Fix title generation using my Codex subscription",
    );
  });

  it("provides a useful prompt for an image-only first message", () => {
    const messages = [{
      id: "user-1",
      role: "user",
      parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,abc" }],
    }] satisfies UIMessage[];

    expect(firstUserMessageForTitle(messages)).toBe("Review the attached image");
  });

  it("slightly staggers the first request and backs retries off", () => {
    expect([0, 1, 2, 10].map(threadTitleRetryDelayMs)).toEqual([750, 1_500, 3_000, 8_000]);
  });
});
