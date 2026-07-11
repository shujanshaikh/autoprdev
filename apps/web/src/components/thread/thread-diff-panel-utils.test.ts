import { describe, expect, it } from "vitest";

import {
  appendDiffPromptContexts,
  createDiffPromptContext,
  createThreadDiffCodeViewItem,
  parseThreadDiffDeepLink,
  type ThreadDiffEntry,
} from "./thread-diff-panel-utils";

const entry: ThreadDiffEntry = {
  id: "message:0",
  messageId: "message",
  partIndex: 0,
  turn: 1,
  tool: "edit",
  file: "src/example.ts",
  patch: [
    "--- src/example.ts\tbefore",
    "+++ src/example.ts\tafter",
    "@@ -1,3 +1,3 @@",
    " const first = 1;",
    "-const value = 1;",
    "+const value = 2;",
    " const last = 3;",
  ].join("\n"),
  additions: 1,
  deletions: 1,
  status: "modified",
  diff: { renderer: "pierre", patch: "patch", status: "modified" },
};

describe("diff prompt contexts", () => {
  it("extracts visible selected lines from a patch when full contents are omitted", () => {
    const context = createDiffPromptContext(entry, {
      start: 2,
      end: 3,
      side: "additions",
    });

    expect(context.content).toBe("2: const value = 2;\n3: const last = 3;");
  });

  it("serializes references after the user's prompt", () => {
    const context = createDiffPromptContext(entry, {
      start: 2,
      end: 2,
      side: "deletions",
    });

    expect(appendDiffPromptContexts("Explain this", [context])).toContain(
      "Explain this\n\n<code_context path=\"src/example.ts\" lines=\"2\" side=\"deletions\">\n2: const value = 1;",
    );
  });

  it("parses a shareable line-range target", () => {
    expect(parseThreadDiffDeepLink({
      diff: "message:0",
      diffFile: "src/example.ts",
      line: "2",
      lineEnd: "3",
      side: "deletions",
      endSide: "additions",
    })).toEqual({
      entryId: "message:0",
      file: "src/example.ts",
      start: 2,
      end: 3,
      side: "deletions",
      endSide: "additions",
    });
  });

  it("ignores invalid line values in a file-only target", () => {
    expect(parseThreadDiffDeepLink({ diff: "message:0", line: "zero" })).toEqual({
      entryId: "message:0",
      file: undefined,
      start: undefined,
      end: undefined,
      side: undefined,
      endSide: undefined,
    });
  });

  it("assigns stable worker cache keys and versions to CodeView items", () => {
    const first = createThreadDiffCodeViewItem(entry, "thread-1", false);
    const second = createThreadDiffCodeViewItem(entry, "thread-1", false);
    expect(first.type).toBe("diff");
    expect(second.type).toBe("diff");
    if (first.type !== "diff" || second.type !== "diff") return;

    expect(first.fileDiff.cacheKey).toBe(second.fileDiff.cacheKey);
    expect(first.fileDiff.cacheKey).toContain("autopr:thread-1:message:0:");
    expect(first.version).toBe(second.version);

    const collapsed = createThreadDiffCodeViewItem(entry, "thread-1", true);
    expect(collapsed.version).toBe((first.version ?? 0) + 1);
  });
});
