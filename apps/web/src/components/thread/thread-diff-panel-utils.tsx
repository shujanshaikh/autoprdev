import { parseDiffFromFile, parsePatchFiles, type CodeViewItem } from "@pierre/diffs";
import { parsePatch } from "diff";

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

export type ThreadChangedFile = {
  entry: ThreadDiffEntry;
  additions: number;
  deletions: number;
};

export function changedFilesForMessage(
  entries: ThreadDiffEntry[],
  messageId: string,
): ThreadChangedFile[] {
  const files = new Map<string, ThreadChangedFile>();

  for (const entry of entries) {
    if (entry.messageId !== messageId) continue;

    const existing = files.get(entry.file);
    files.set(entry.file, {
      entry,
      additions: (existing?.additions ?? 0) + entry.additions,
      deletions: (existing?.deletions ?? 0) + entry.deletions,
    });
  }

  return [...files.values()];
}

export type DiffPromptContext = {
  id: string;
  file: string;
  start: number;
  end: number;
  side: "additions" | "deletions";
  endSide: "additions" | "deletions";
  content: string;
};

export type ThreadDiffDeepLink = {
  entryId: string;
  file?: string;
  requestId?: number;
  start?: number;
  end?: number;
  side?: "additions" | "deletions";
  endSide?: "additions" | "deletions";
};

function positiveLineNumber(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseThreadDiffDeepLink(search: Record<string, unknown>): ThreadDiffDeepLink | undefined {
  if (typeof search.diff !== "string" || search.diff.length === 0) return undefined;
  const side = search.side === "deletions" ? "deletions" : search.side === "additions" ? "additions" : undefined;
  const endSide = search.endSide === "deletions" ? "deletions" : search.endSide === "additions" ? "additions" : undefined;
  return {
    entryId: search.diff,
    file: typeof search.diffFile === "string" ? search.diffFile : undefined,
    start: positiveLineNumber(search.line),
    end: positiveLineNumber(search.lineEnd),
    side,
    endSide,
  };
}

function stringHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createThreadDiffCodeViewItem(
  entry: ThreadDiffEntry,
  threadId: string,
  collapsed: boolean,
): CodeViewItem {
  const source = entry.patch || `${entry.oldContent ?? ""}\0${entry.newContent ?? ""}`;
  const contentHash = stringHash(source);
  const cacheKey = `autopr:${threadId}:${entry.id}:${contentHash.toString(36)}`;
  const version = contentHash * 2 + (collapsed ? 1 : 0);

  if (entry.patch) {
    try {
      const fileDiff = parsePatchFiles(entry.patch, cacheKey, true)[0]?.files[0];
      if (fileDiff) {
        return { id: entry.id, type: "diff", fileDiff, collapsed, version };
      }
    } catch {
      // Fall through to full contents or a lightweight unavailable item.
    }
  }

  if (typeof entry.newContent === "string") {
    const fileDiff = parseDiffFromFile(
      {
        name: entry.file,
        contents: entry.oldContent ?? "",
        cacheKey: `${cacheKey}:before`,
      },
      {
        name: entry.file,
        contents: entry.newContent,
        cacheKey: `${cacheKey}:after`,
      },
    );
    fileDiff.cacheKey = cacheKey;
    return { id: entry.id, type: "diff", fileDiff, collapsed, version };
  }

  return {
    id: entry.id,
    type: "file",
    file: {
      name: entry.file,
      contents: "Diff content is unavailable for this stored change.",
      cacheKey,
    },
    collapsed,
    version,
  };
}

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
  const rawStart = Math.max(1, range.start);
  const rawEnd = Math.max(1, range.end);
  const start = side === endSide ? Math.min(rawStart, rawEnd) : rawStart;
  const end = side === endSide ? Math.max(rawStart, rawEnd) : rawEnd;
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
