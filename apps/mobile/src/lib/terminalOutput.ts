const MAX_COLUMN = 1_000;

function csiParameter(parameters: string, fallback: number) {
  const first = parameters.replace(/^\?/, "").split(";")[0];
  if (!first) return fallback;
  const parsed = Number(first);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Converts an xterm PTY byte stream into a stable plain-text snapshot.
 *
 * Shells repaint their prompt with carriage returns and erase-line sequences,
 * especially after a terminal resize. Keeping a small cursor-aware text buffer
 * means those redraws replace the current line instead of appearing as repeated
 * prompts in React Native's append-only Text view.
 */
export class TerminalOutputSanitizer {
  private remainder = "";
  private lines: string[][] = [[]];
  private row = 0;
  private column = 0;

  constructor(private readonly maxLength = Number.POSITIVE_INFINITY) {}

  private currentLine() {
    this.lines[this.row] ??= [];
    return this.lines[this.row];
  }

  private moveRows(change: number) {
    this.row = Math.max(0, this.row + change);
    while (this.lines.length <= this.row) this.lines.push([]);
  }

  private setColumn(column: number) {
    this.column = Math.min(MAX_COLUMN, Math.max(0, column));
  }

  private handleCsi(parameters: string, command: string) {
    const amount = Math.max(1, csiParameter(parameters, 1));

    if (command === "A") this.moveRows(-amount);
    if (command === "B") this.moveRows(amount);
    if (command === "C") this.setColumn(this.column + amount);
    if (command === "D") this.setColumn(this.column - amount);
    if (command === "E") {
      this.moveRows(amount);
      this.setColumn(0);
    }
    if (command === "F") {
      this.moveRows(-amount);
      this.setColumn(0);
    }
    if (command === "G") this.setColumn(amount - 1);

    if (command === "K") {
      const mode = csiParameter(parameters, 0);
      const line = this.currentLine();
      if (mode === 0) line.splice(this.column);
      if (mode === 1) {
        const end = Math.min(this.column, line.length - 1);
        for (let index = 0; index <= end; index += 1) line[index] = " ";
      }
      if (mode === 2) line.splice(0);
    }

    if (command === "J" && csiParameter(parameters, 0) >= 2) {
      this.lines = [[]];
      this.row = 0;
      this.setColumn(0);
    }
  }

  private write(character: string) {
    const line = this.currentLine();
    while (line.length < this.column) line.push(" ");
    line[this.column] = character;
    this.setColumn(this.column + 1);
  }

  private snapshot() {
    let totalLength = this.lines.reduce((sum, line) => sum + line.length + 1, -1);

    while (totalLength > this.maxLength && this.lines.length > 1) {
      const removed = this.lines.shift();
      totalLength -= (removed?.length ?? 0) + 1;
      this.row = Math.max(0, this.row - 1);
    }

    if (totalLength > this.maxLength) {
      const overflow = totalLength - this.maxLength;
      this.lines[0]?.splice(0, overflow);
      if (this.row === 0) this.column = Math.max(0, this.column - overflow);
    }

    return this.lines.map((line) => line.join("")).join("\n");
  }

  push(chunk: string) {
    const value = `${this.remainder}${chunk}`;
    this.remainder = "";

    for (let index = 0; index < value.length;) {
      const character = value[index];

      if (character === "\x1b" && value[index + 1] === "]") {
        const bellEnd = value.indexOf("\x07", index + 2);
        const stringEnd = value.indexOf("\x1b\\", index + 2);
        const candidates = [bellEnd, stringEnd].filter((candidate) => candidate >= 0);
        if (candidates.length === 0) {
          this.remainder = value.slice(index);
          break;
        }
        const end = Math.min(...candidates);
        index = end + (end === bellEnd ? 1 : 2);
        continue;
      }

      const isCsi = character === "\u009b" || (character === "\x1b" && value[index + 1] === "[");
      if (isCsi) {
        const parameterStart = index + (character === "\u009b" ? 1 : 2);
        let end = parameterStart;
        while (end < value.length && !/[@-~]/.test(value[end] ?? "")) end += 1;
        if (end >= value.length) {
          this.remainder = value.slice(index);
          break;
        }
        this.handleCsi(value.slice(parameterStart, end), value[end] ?? "");
        index = end + 1;
        continue;
      }

      if (character === "\x1b") {
        if (index + 1 >= value.length) {
          this.remainder = value.slice(index);
          break;
        }
        index += 2;
        continue;
      }

      if (character === "\r") {
        this.setColumn(0);
      } else if (character === "\n") {
        this.moveRows(1);
        this.setColumn(0);
      } else if (character === "\b") {
        this.setColumn(this.column - 1);
      } else if (character === "\t") {
        const spaces = 8 - (this.column % 8);
        for (let count = 0; count < spaces; count += 1) this.write(" ");
      } else if ((character?.charCodeAt(0) ?? 0) >= 0x20 && character !== "\x7f") {
        this.write(character);
      }
      index += 1;
    }

    return this.snapshot();
  }

  reset() {
    this.remainder = "";
    this.lines = [[]];
    this.row = 0;
    this.setColumn(0);
  }
}
