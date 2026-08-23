import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  firstUserMessageForTitle,
  requestGeneratedThreadTitle,
  ThreadTitleRequestError,
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

  it("retries only temporary title request failures", () => {
    expect(new ThreadTitleRequestError("Bad Request", 400).retryable).toBe(false);
    expect(new ThreadTitleRequestError("Too Many Requests", 429).retryable).toBe(true);
    expect(new ThreadTitleRequestError("Unavailable", 503).retryable).toBe(true);
  });

  it("requests a forced regeneration without trusting the current title", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ title: "A better title", updated: true }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    await expect(requestGeneratedThreadTitle({
      projectId: "project/1",
      threadId: "thread/1",
      regenerate: true,
    })).resolves.toEqual({ title: "A better title", updated: true });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ action: "regenerate_title" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/project/project%2F1/thread/thread%2F1",
    );
    fetchMock.mockRestore();
  });
});
