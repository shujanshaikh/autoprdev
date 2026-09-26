import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { preserveLargeOutput } from "./output-artifact";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, mkdtemp: vi.fn(original.mkdtemp) };
});

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

  it("keeps evidence in a worker file and the preview bounded if upload fails", async () => {
    const output = "diagnostic α\n".repeat(100_000) + "final failure";
    const result = await preserveLargeOutput(output, async () => { throw new Error("disk full"); });
    if (!("workerArtifactPath" in result) || typeof result.workerArtifactPath !== "string") throw new Error("Missing recovery file");
    try {
      expect(await readFile(result.workerArtifactPath, "utf8")).toBe(output);
      expect(result.text).toContain("operator recovery file, unavailable to sandbox tools");
      expect(result.text).toContain("final failure");
      expect(Buffer.byteLength(result.text)).toBeLessThan(4_500);
      expect(result.totalBytes).toBe(Buffer.byteLength(output));
      expect(result.outputBytes).toBe(Buffer.byteLength(result.text));
      expect(result.truncated).toBe(true);
      expect(result).not.toHaveProperty("artifactPath");
    } finally {
      await rm(dirname(result.workerArtifactPath), { recursive: true, force: true });
    }
  });

  it("fails explicitly with bounded diagnostics if neither storage location works", async () => {
    vi.mocked(mkdtemp).mockRejectedValueOnce(new Error("worker disk full"));
    const output = "x".repeat(1_000_000) + "\nfinal failure";
    const error = await preserveLargeOutput(output, async () => { throw new Error("upload failed"); })
      .then(() => { throw new Error("Expected storage failure"); }, (error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw error;
    expect(error.message).toContain("Full output was not saved");
    expect(error.message).toContain("final failure");
    expect(Buffer.byteLength(error.message)).toBeLessThan(4_500);
  });
});
