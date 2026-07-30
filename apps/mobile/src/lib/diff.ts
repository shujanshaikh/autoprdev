export type DiffLineType = "context" | "add" | "delete" | "meta" | "hunk";

export type DiffLine = {
  id: string;
  type: DiffLineType;
  oldLine: number | null;
  newLine: number | null;
  content: string;
};

export type ParsedDiffFile = {
  id: string;
  oldPath: string | null;
  newPath: string | null;
  lines: DiffLine[];
};

export type DiffEntry = {
  id: string;
  messageId: string;
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
  oldContent?: string | null;
  newContent?: string;
};

function hunkStart(line: string) {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return match
    ? { oldLine: Number.parseInt(match[1] ?? "0", 10), newLine: Number.parseInt(match[2] ?? "0", 10) }
    : null;
}

function diffPath(line: string, prefix: "--- " | "+++ ") {
  if (!line.startsWith(prefix)) return undefined;
  const raw = line.slice(prefix.length).trim();
  return raw === "/dev/null" ? null : raw.replace(/^[ab]\//, "");
}

// Adapted to AutoPR's stored patches from the T3 Code mobile unified-diff model.
export function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  let current: { oldPath: string | null; newPath: string | null; lines: DiffLine[] } | null = null;
  let oldLine: number | null = null;
  let newLine: number | null = null;

  const push = () => {
    if (!current) return;
    files.push({
      id: `${current.oldPath ?? "null"}:${current.newPath ?? "null"}:${files.length}`,
      ...current,
    });
  };

  for (const rawLine of diff.replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      push();
      const match = rawLine.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = { oldPath: match?.[1] ?? null, newPath: match?.[2] ?? null, lines: [] };
      oldLine = null;
      newLine = null;
      continue;
    }
    current ??= { oldPath: null, newPath: null, lines: [] };
    const oldPath = diffPath(rawLine, "--- ");
    if (oldPath !== undefined) {
      current.oldPath = oldPath;
      continue;
    }
    const newPath = diffPath(rawLine, "+++ ");
    if (newPath !== undefined) {
      current.newPath = newPath;
      continue;
    }
    const hunk = hunkStart(rawLine);
    if (hunk) {
      oldLine = hunk.oldLine;
      newLine = hunk.newLine;
      current.lines.push({
        id: `${current.lines.length}:hunk`,
        type: "hunk",
        oldLine: null,
        newLine: null,
        content: rawLine,
      });
      continue;
    }
    if (oldLine === null || newLine === null) {
      if (rawLine) {
        current.lines.push({
          id: `${current.lines.length}:meta`,
          type: "meta",
          oldLine: null,
          newLine: null,
          content: rawLine,
        });
      }
      continue;
    }
    const marker = rawLine[0];
    const content = rawLine.slice(1);
    if (marker === "+") {
      current.lines.push({ id: `${current.lines.length}:add:${newLine}`, type: "add", oldLine: null, newLine, content });
      newLine += 1;
    } else if (marker === "-") {
      current.lines.push({ id: `${current.lines.length}:delete:${oldLine}`, type: "delete", oldLine, newLine: null, content });
      oldLine += 1;
    } else {
      current.lines.push({
        id: `${current.lines.length}:context:${oldLine}:${newLine}`,
        type: "context",
        oldLine,
        newLine,
        content: marker === " " ? content : rawLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }
  push();
  return files.filter((file) => file.lines.length > 0 || file.oldPath || file.newPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolSlug(part: Record<string, unknown>) {
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") return part.toolName;
  return typeof part.type === "string" && part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : "";
}

export function extractDiffEntries(messages: readonly unknown[]): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const messageValue of messages) {
    if (!isRecord(messageValue) || !Array.isArray(messageValue.parts) || typeof messageValue.messageId !== "string") {
      continue;
    }
    for (let index = 0; index < messageValue.parts.length; index += 1) {
      const part = messageValue.parts[index];
      if (!isRecord(part) || !["edit", "write"].includes(toolSlug(part))) continue;
      const output = isRecord(part.output) ? part.output : null;
      const details = output && isRecord(output.details) ? output.details : null;
      const diff = details && isRecord(details.diff) ? details.diff : null;
      if (!diff) continue;
      const patch = typeof diff.patch === "string" ? diff.patch : "";
      const file = typeof details?.path === "string"
        ? details.path
        : typeof diff.fileName === "string" ? diff.fileName : "Changed file";
      let additions = 0;
      let deletions = 0;
      for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
        if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
      }
      const oldContent = typeof diff.oldContent === "string" || diff.oldContent === null
        ? diff.oldContent
        : undefined;
      const newContent = typeof diff.newContent === "string" ? diff.newContent : undefined;
      const status = diff.status === "added" || diff.status === "deleted" || diff.status === "modified"
        ? diff.status
        : oldContent === null || oldContent === "" ? "added" : newContent === "" ? "deleted" : "modified";
      entries.push({
        id: `${messageValue.messageId}:${index}`,
        messageId: messageValue.messageId,
        file,
        patch,
        additions,
        deletions,
        status,
        oldContent,
        newContent,
      });
    }
  }
  return entries;
}
