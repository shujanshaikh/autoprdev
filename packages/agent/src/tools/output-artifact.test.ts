import { describe, expect, it, vi } from "vitest";
import { preserveLargeOutput } from "./output-artifact";

describe("output artifacts", () => {
  it("preserves the full UTF-8 output and returns a small searchable preview", async () => {
    const output = "diagnostic α\n".repeat(6_000) + "final failure";
    const upload = vi.fn().mockResolvedValue(undefined);
    const result = await preserveLargeOutput(output, upload);
    expect(upload).toHaveBeenCalledWith(Buffer.from(output), expect.stringMatching(/^\/tmp\/autopr-output-.*\.log$/));
    expect(result.text).toContain("final failure");
    expect(result.text).toContain("Use bash");
    expect(Buffer.byteLength(result.text)).toBeLessThan(4_500);
  });

  it("keeps all evidence inline if saving the artifact fails", async () => {
    const output = "x".repeat(80_000);
    const result = await preserveLargeOutput(output, async () => { throw new Error("disk full"); });
    expect(result.text).toBe(output);
    expect(result.truncated).toBe(false);
  });
});
