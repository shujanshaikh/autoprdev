import { describe, expect, it } from "vitest";

import { createDaytonaComputerTool } from "./computer";

function safeParse(schema: unknown, value: unknown): { success: boolean } {
  return (schema as { safeParse(input: unknown): { success: boolean } }).safeParse(value);
}

describe("Daytona computer tool input", () => {
  const computer = createDaytonaComputerTool({ cacheKey: "computer-schema" });

  it("accepts absolute HTTP(S) preview URLs", () => {
    expect(safeParse(computer.inputSchema, {
      actions: [{ type: "open_url", url: "http://localhost:3000/project/1" }],
    }).success).toBe(true);
    expect(safeParse(computer.inputSchema, {
      action: "open_url",
      url: "https://example.com",
    }).success).toBe(true);
  });

  it("rejects script, file, and malformed browser targets", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "localhost:3000"]) {
      expect(safeParse(computer.inputSchema, {
        actions: [{ type: "open_url", url }],
      }).success).toBe(false);
    }
  });
});
