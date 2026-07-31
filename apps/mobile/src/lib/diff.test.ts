import { describe, expect, it } from "vitest";

import { extractDiffEntries, parseUnifiedDiff } from "./diff";

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
