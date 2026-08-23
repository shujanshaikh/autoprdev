import { describe, expect, it } from "vitest";

import { firstUserMessageText, shouldRetryThreadTitleError, threadTitleRetryDelayMs } from "./threadTitle";

describe("threadTitle", () => {
  it("uses the first non-empty user text", () => {
    expect(firstUserMessageText([
      { role: "assistant", parts: [{ type: "text", text: "skip" }] },
      { role: "user", parts: [{ type: "text", text: "  Fix the login flow  " }] },
      { role: "user", parts: [{ type: "text", text: "later" }] },
    ])).toBe("Fix the login flow");
  });

  it("uses an image-oriented fallback for file-only prompts", () => {
    expect(firstUserMessageText([
      { role: "user", parts: [{ type: "file", url: "https://example.test/image.png" }] },
    ])).toBe("Review the attached image");
  });

  it("backs retries off with the same bounded schedule as web", () => {
    expect([0, 1, 2, 10].map(threadTitleRetryDelayMs)).toEqual([750, 1_500, 3_000, 8_000]);
  });

  it("retries transient failures but not classified permanent failures", () => {
    expect(shouldRetryThreadTitleError(new TypeError("Network request failed"))).toBe(true);
    expect(shouldRetryThreadTitleError({ retryable: true })).toBe(true);
    expect(shouldRetryThreadTitleError({ retryable: false })).toBe(false);
  });

  it("keeps title requests within the server contract", () => {
    expect(firstUserMessageText([
      { role: "user", parts: [{ type: "text", text: "x".repeat(9_000) }] },
    ])).toHaveLength(8_000);
  });
});
