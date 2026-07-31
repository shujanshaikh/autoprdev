import { describe, expect, it } from "vitest";

import { messageParts } from "./messages";

describe("messageParts", () => {
  it("formats tool input and output as renderable markdown", () => {
    const [part] = messageParts([{
      type: "tool-shell",
      state: "output-available",
      input: { command: "pnpm test" },
      output: { content: "**Passed**\n\n- 12 tests" },
    }]);

    expect(part).toMatchObject({
      kind: "tool",
      name: "shell",
      failed: false,
    });
    expect(part?.kind === "tool" ? part.details : undefined).toContain(
      "### Input\n\n```json",
    );
    expect(part?.kind === "tool" ? part.details : undefined).toContain(
      "### Output\n\n**Passed**\n\n- 12 tests",
    );
  });

  it("carries the header presentation a tool row needs", () => {
    const [streamingEdit] = messageParts([{
      type: "tool-edit",
      state: "input-streaming",
      input: { path: "src/lib/diff.ts" },
    }]);

    expect(streamingEdit).toMatchObject({
      kind: "tool",
      slug: "edit",
      label: "Editing",
      summary: "diff.ts",
      path: "src/lib/diff.ts",
      streaming: true,
      explore: false,
      failed: false,
    });
  });

  it("marks read-only tools as exploration once they have finished", () => {
    const [read] = messageParts([{
      type: "tool-read",
      state: "output-available",
      input: { path: "src/App.tsx" },
      output: { content: "…" },
    }]);

    expect(read).toMatchObject({ label: "Read", explore: true, streaming: false });
  });

  it("surfaces the error text as the header summary of a failed tool", () => {
    const [failed] = messageParts([{
      type: "tool-bash",
      state: "output-error",
      input: { command: "pnpm test" },
      errorText: "Command exited with 1",
    }]);

    expect(failed).toMatchObject({ failed: true, summary: "Command exited with 1" });
  });
});
