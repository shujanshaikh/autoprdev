import { describe, expect, it } from "vitest";

import { TerminalOutputSanitizer } from "./terminalOutput";

describe("TerminalOutputSanitizer", () => {
  it("removes complete color, cursor, mode, and OSC sequences", () => {
    const sanitizer = new TerminalOutputSanitizer();
    const output = sanitizer.push(
      "\x1b]0;workspace\x07\x1b[0m\x1b[38;2;231;229;229m/home/repo"
      + "\x1b[0m\x1b[K\x1b[?1h\x1b=\x1b[?2004h\r\n",
    );

    expect(output).toBe("/home/repo\n");
  });

  it("holds split escape sequences until the next chunk", () => {
    const sanitizer = new TerminalOutputSanitizer();

    expect(sanitizer.push("before \x1b[38;2;")).toBe("before ");
    expect(sanitizer.push("255;0;0mred\x1b[0m after")).toBe("red after");
  });

  it("applies backspaces and ignores bare carriage returns", () => {
    const sanitizer = new TerminalOutputSanitizer();

    expect(sanitizer.push("abc\bD\rready\r\n")).toBe("abDready\n");
  });
});
