export type ThreadDiffEntry = {
  id: string;
  messageId: string;
  partIndex: number;
  turn: number;
  tool: "edit" | "write";
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
  oldContent?: string | null;
  newContent?: string;
  diff: import("@/components/ai-elements/tool").ToolDiffPayload;
};

export type DiffPromptContext = {
  id: string;
  file: string;
  start: number;
  end: number;
  side: "additions" | "deletions";
  endSide: "additions" | "deletions";
  content: string;
};

type SelectedLineRange = import("@pierre/diffs").SelectedLineRange;

function numberedLines(contents: string | null | undefined, start: number, end: number) {
  if (typeof contents !== "string") return "";

  const first = Math.max(1, Math.min(start, end));
  const last = Math.max(first, Math.max(start, end));
  return contents
    .split("\n")
    .slice(first - 1, last)
    .map((line, index) => `${first + index}: ${line}`)
    .join("\n");
}

function patchLines(patch: string, side: "additions" | "deletions") {
  const lines = new Map<number, string>();
  try {
    for (const file of parsePatch(patch)) {
      for (const hunk of file.hunks) {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        for (const value of hunk.lines) {
          const marker = value[0];
          if (marker === " ") {
            lines.set(side === "additions" ? newLine : oldLine, value.slice(1));
            oldLine += 1;
            newLine += 1;
          } else if (marker === "-") {
            if (side === "deletions") lines.set(oldLine, value.slice(1));
            oldLine += 1;
          } else if (marker === "+") {
            if (side === "additions") lines.set(newLine, value.slice(1));
            newLine += 1;
          }
        }
      }
    }
  } catch {
    // The fallback below will explain that stored source content is unavailable.
  }
  return lines;
}

function selectedLines(
  entry: ThreadDiffEntry,
  side: "additions" | "deletions",
  start: number,
  end: number,
) {
  const source = side === "additions" ? entry.newContent : entry.oldContent;
  const fromSource = numberedLines(source, start, end);
  if (fromSource) return fromSource;

  const first = Math.max(1, Math.min(start, end));
  const last = Math.max(first, Math.max(start, end));
  const visiblePatchLines = patchLines(entry.patch, side);
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const lineNumber = first + index;
    const value = visiblePatchLines.get(lineNumber);
    return value === undefined ? undefined : `${lineNumber}: ${value}`;
  })
    .filter((value): value is string => value !== undefined)
    .join("\n");
}

export function createDiffPromptContext(
  entry: ThreadDiffEntry,
  range: SelectedLineRange,
): DiffPromptContext {
  const side = range.side ?? "additions";
  const endSide = range.endSide ?? side;
  const start = Math.max(1, range.start);
  const end = Math.max(1, range.end);
  let content: string;

  if (side === endSide) {
    content = selectedLines(entry, side, start, end);
  } else {
    const startLabel = side === "additions" ? "new" : "old";
    const endLabel = endSide === "additions" ? "new" : "old";
    content = [
      `${startLabel} file:`,
      selectedLines(entry, side, start, start),
      `${endLabel} file:`,
      selectedLines(entry, endSide, end, end),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (!content) {
    content = `Selected ${side} lines ${Math.min(start, end)}-${Math.max(start, end)} (source content unavailable).`;
  }

  return {
    id: `${entry.id}:${side}:${start}:${endSide}:${end}`,
    file: entry.file,
    start,
    end,
    side,
    endSide,
    content,
  };
}

export function formatDiffPromptContextLabel(context: DiffPromptContext) {
  const fileName = context.file.split("/").at(-1) ?? context.file;
  const range = context.start === context.end
    ? `${context.start}`
    : `${context.start}–${context.end}`;
  return `${fileName} (${range})`;
}

export function appendDiffPromptContexts(message: string, contexts: DiffPromptContext[]) {
  if (contexts.length === 0) return message.trim();

  const serialized = contexts
    .map((context) => {
      const lines = context.start === context.end
        ? `${context.start}`
        : `${context.start}-${context.end}`;
      return [
        `<code_context path=${JSON.stringify(context.file)} lines="${lines}" side="${context.side}">`,
        context.content,
        "</code_context>",
      ].join("\n");
    })
    .join("\n\n");

  return message.trim() ? `${message.trim()}\n\n${serialized}` : serialized;
}
import { parsePatch } from "diff";
