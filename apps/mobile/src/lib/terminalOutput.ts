const OSC_SEQUENCE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
const CSI_SEQUENCE = /(?:\x1B\[|\u009B)[0-?]*[ -/]*[@-~]/g;
const TWO_BYTE_ESCAPE = /\x1B[\s\S]/g;
const INCOMPLETE_ESCAPE = /(?:\x1B\][^\x07]*(?:\x1B)?|(?:\x1B\[|\u009B)[0-?]*[ -/]*|\x1B)$/;

function removeBackspaces(value: string) {
  const output: string[] = [];
  for (const character of value) {
    if (character === "\b") {
      output.pop();
    } else if (character !== "\0") {
      output.push(character);
    }
  }
  return output.join("");
}

function sanitizeCompleteTerminalText(value: string) {
  return removeBackspaces(value
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(TWO_BYTE_ESCAPE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, ""));
}

/**
 * Converts an xterm PTY byte stream into stable plain-text scrollback.
 * Incomplete escape sequences are retained until the next socket chunk so
 * ANSI parameters never leak into the native Text renderer.
 */
export class TerminalOutputSanitizer {
  private remainder = "";

  push(chunk: string) {
    const value = `${this.remainder}${chunk}`;
    const incomplete = value.match(INCOMPLETE_ESCAPE);
    const complete = incomplete ? value.slice(0, -incomplete[0].length) : value;
    this.remainder = incomplete?.[0] ?? "";
    return sanitizeCompleteTerminalText(complete);
  }

  reset() {
    this.remainder = "";
  }
}
