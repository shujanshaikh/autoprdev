import { readyTerminalPort } from "@autopr/backend/convex/lib/sandboxCommandOutput";
import { describe, expect, it } from "vitest";

describe("terminal preview readiness", () => {
  it("accepts E2B's stdout marker when no exit code is available", () => {
    expect(readyTerminalPort({
      stdout: "AUTOPR_TERMINAL_PORT=39834\n",
    }, 39834)).toBe(39834);
  });

  it("accepts Daytona's result alias", () => {
    expect(readyTerminalPort({
      exitCode: 0,
      result: "AUTOPR_TERMINAL_PORT=39725\n",
    }, 39725)).toBe(39725);
  });

  it("does not accept a marker for a different port", () => {
    expect(readyTerminalPort({
      exitCode: 1,
      stdout: "AUTOPR_TERMINAL_PORT=32697\n",
    }, 39834)).toBeUndefined();
  });

  it("does not treat stderr as a readiness marker", () => {
    expect(readyTerminalPort({
      exitCode: 1,
      stderr: "AUTOPR_TERMINAL_PORT=39834\n",
    }, 39834)).toBeUndefined();
  });
});
