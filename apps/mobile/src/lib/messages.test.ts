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
});
