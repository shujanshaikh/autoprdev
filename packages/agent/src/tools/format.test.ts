import { describe, expect, it } from "vitest";

import { completeUtf8PrefixLength, isProbablyBinary, truncateToolOutput } from "./format";

describe("tool output formatting", () => {
  it("keeps the error tail for oversized command output", () => {
    const result = truncateToolOutput(
      `${Array.from({ length: 20 }, (_, index) => `progress ${index}`).join("\n")}\nFAIL: useful diagnostic`,
      { direction: "tail", maxLines: 4, maxBytes: 10_000 },
    );

    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("lines");
    expect(result.text).toContain("showing tail");
    expect(result.text).toContain("FAIL: useful diagnostic");
    expect(result.text).not.toContain("progress 0\n");
  });

  it("truncates multibyte text only at valid UTF-8 boundaries", () => {
    const result = truncateToolOutput("prefix\n🙂🙂🙂🙂🙂", {
      direction: "tail",
      maxBytes: 9,
      maxLines: 10,
    });

    expect(result.text).not.toContain("�");
    expect(result.text).toContain("🙂🙂");
  });

  it("detects control-heavy binary data without rejecting UTF-8 text", () => {
    expect(isProbablyBinary(Buffer.from([1, 2, 3, 4, 5, 65]))).toBe(true);
    expect(isProbablyBinary(Buffer.from("नमस्ते 🙂\n", "utf8"))).toBe(false);
  });

  it("finds a safe continuation point when a byte window splits UTF-8", () => {
    const complete = Buffer.from("hello🙂", "utf8");
    const split = complete.subarray(0, complete.length - 2);
    expect(completeUtf8PrefixLength(split)).toBe(Buffer.byteLength("hello"));
    expect(isProbablyBinary(split)).toBe(false);
  });

  it("does not treat invalid terminal bytes as an incomplete UTF-8 sequence", () => {
    expect(completeUtf8PrefixLength(Buffer.from([0x61, 0xff]))).toBe(-1);
    expect(completeUtf8PrefixLength(Buffer.from([0x61, 0xc0]))).toBe(-1);
    expect(isProbablyBinary(Buffer.from([0x61, 0xff]))).toBe(true);
  });
});
