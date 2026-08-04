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
    expect(sanitizer.push("255;0;0mred\x1b[0m after")).toBe("before red after");
  });

  it("applies backspaces and carriage-return line redraws", () => {
    const sanitizer = new TerminalOutputSanitizer();

    expect(sanitizer.push("abc\bD\rready\r\n")).toBe("ready\n");
  });

  it("replaces a repainted shell prompt instead of duplicating it", () => {
    const sanitizer = new TerminalOutputSanitizer();

    expect(sanitizer.push("➜  /home/repo git:main")).toBe("➜  /home/repo git:main");
    expect(sanitizer.push("\r\x1b[2K➜  /home/repo git:main")).toBe(
      "➜  /home/repo git:main",
    );
  });

  it("clamps hostile cursor-column parameters before padding a line", () => {
    const sanitizer = new TerminalOutputSanitizer();

    const output = sanitizer.push("start\x1b[999999999CX");

    expect(output.length).toBe(1_001);
    expect(output.endsWith("X")).toBe(true);
  });
});
