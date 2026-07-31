import { describe, expect, it } from "vitest";

import {
  extractDiffEntries,
  hunkContext,
  hunkRange,
  parseUnifiedDiff,
  visibleWhitespace,
  wordDiffSegments,
} from "./diff";

describe("parseUnifiedDiff", () => {
  it("tracks line numbers across hunks and normalizes CRLF", () => {
    const [file] = parseUnifiedDiff([
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -2,2 +2,3 @@",
      " context",
      "-old",
      "+new",
      "+extra",
    ].join("\r\n"));

    expect(file?.oldPath).toBe("src/a.ts");
    expect(file?.newPath).toBe("src/a.ts");
    expect(file?.lines.map((line) => [line.type, line.oldLine, line.newLine])).toEqual([
      ["hunk", null, null],
      ["context", 2, 2],
      ["delete", 3, null],
      ["add", null, 3],
      ["add", null, 4],
    ]);
  });

  it("recognizes added and deleted files", () => {
    const files = parseUnifiedDiff([
      "diff --git a/new.ts b/new.ts",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1 @@",
      "+new",
      "diff --git a/old.ts b/old.ts",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-old",
    ].join("\n"));

    expect(files.map((file) => [file.oldPath, file.newPath])).toEqual([
      [null, "new.ts"],
      ["old.ts", null],
    ]);
  });
});

describe("extractDiffEntries", () => {
  it("extracts stored edit tool patches and counts changes", () => {
    expect(extractDiffEntries([{
      messageId: "assistant-1",
      parts: [{
        type: "tool-edit",
        output: {
          details: {
            path: "src/a.ts",
            diff: {
              patch: "--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new",
              oldContent: "old",
              newContent: "new",
            },
          },
        },
      }],
    }])).toEqual([
      expect.objectContaining({
        file: "src/a.ts",
        additions: 1,
        deletions: 1,
        status: "modified",
      }),
    ]);
  });
});

describe("wordDiffSegments", () => {
  const linesOf = (patch: string) => parseUnifiedDiff(patch).flatMap((file) => file.lines);

  it("pairs a balanced deletion and addition run word by word", () => {
    const lines = linesOf([
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-const timeout = 500;",
      "+const timeout = 900;",
    ].join("\n"));
    const segments = wordDiffSegments(lines);
    const deletion = lines.find((line) => line.type === "delete");
    const addition = lines.find((line) => line.type === "add");

    expect(segments.get(deletion!.id)?.filter((segment) => segment.highlight))
      .toEqual([{ text: "500", highlight: true }]);
    expect(segments.get(addition!.id)?.filter((segment) => segment.highlight))
      .toEqual([{ text: "900", highlight: true }]);
  });

  it("leaves unbalanced runs alone: they are real insertions, not rewrites", () => {
    const lines = linesOf([
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,2 @@",
      "-const timeout = 500;",
      "+const timeout = 900;",
      "+const retries = 2;",
    ].join("\n"));

    expect(wordDiffSegments(lines).size).toBe(0);
  });
});

describe("visibleWhitespace", () => {
  it("expands tabs and protects leading indentation", () => {
    expect(visibleWhitespace("\tvalue", true)).toBe("\u00A0\u00A0\u00A0\u00A0value");
  });

  it("only protects indentation at the start of a line", () => {
    expect(visibleWhitespace("  trailing segment", false)).toBe("  trailing segment");
  });
});

describe("hunk headers", () => {
  it("splits the range from the enclosing context", () => {
    expect(hunkRange("@@ -12,7 +12,9 @@ function send() {")).toBe("@@ -12,7 +12,9 @@");
    expect(hunkContext("@@ -12,7 +12,9 @@ function send() {")).toBe("function send() {");
  });
});
