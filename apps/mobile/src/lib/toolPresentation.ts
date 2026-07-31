/**
 * Header presentation for tool calls, kept in step with the web thread so a
 * conversation reads the same on both surfaces.
 */

export type ToolHeader = {
  /** Bare tool slug, e.g. "edit". */
  slug: string;
  /** Leading label: an action for file edits, otherwise the tool name. */
  label: string;
  /** Secondary line derived from the tool input. */
  summary: string;
  /** File the tool acted on, when it names one. */
  path?: string;
  /** Read-only tools collapse into a single "Explored" group. */
  explore: boolean;
};

/** Tools that get their own expandable row; everything else is exploration. */
const PRIMARY_TOOL_SLUGS = new Set(["edit", "write", "bash", "computer"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toolSlug(type: string, toolName?: string) {
  if (type === "dynamic-tool" && toolName) return toolName;
  const parts = type.split("-");
  if (parts[0] === "tool" && parts.length > 1) return parts.slice(1).join("-");
  return parts.slice(1).join("-") || type;
}

export function pathBasename(path: string) {
  const trimmed = path.replace(/\/+$/, "") || path;
  const index = trimmed.lastIndexOf("/");
  return (index === -1 ? trimmed : trimmed.slice(index + 1)) || "/";
}

/** Keeps long absolute paths readable: the last two segments only. */
export function shortDirectory(path: string) {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean).slice(0, -1);
  return segments.length <= 2 ? segments.join("/") : segments.slice(-2).join("/");
}

function displayToolLabel(slug: string) {
  if (slug === "find") return "Glob";
  if (!slug) return "Tool";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function bashCommand(input: unknown) {
  return isRecord(input) && typeof input.command === "string" ? input.command.trim() : "";
}

function bashHeaderLabel(input: unknown) {
  const normalized = bashCommand(input).replace(/\s+/g, " ").trim();
  if (!normalized) return "Run shell command";
  if (/\b(vite|dev)\b/.test(normalized) && /\b(run|npm|pnpm|bun|yarn)\b/.test(normalized)) {
    return "Start dev server";
  }
  if (/\bcheck-types\b/.test(normalized)) return "Run typecheck";
  if (/\b(test|vitest|jest|playwright)\b/.test(normalized)) return "Run tests";
  if (/^(cat|sed|nl|tail|head)\b/.test(normalized)) return "Read file";
  if (/^(rg|grep|find)\b/.test(normalized)) return "Search files";
  if (/^(ls|pwd|git status)\b/.test(normalized)) return "Inspect workspace";
  return "Run shell command";
}

function fileOperationLabel(slug: "edit" | "write", streaming: boolean, failed: boolean) {
  if (slug === "write") {
    if (streaming) return "Writing";
    return failed ? "Write failed" : "Created";
  }
  if (streaming) return "Editing";
  return failed ? "Edit failed" : "Edited";
}

function formatPrimitive(value: unknown) {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function shallowEntries(data: Record<string, unknown>) {
  return Object.entries(data).filter(([, value]) => value !== undefined);
}

function isShallowDisplayable(data: Record<string, unknown>) {
  return shallowEntries(data).every(([, value]) => {
    if (value === null) return true;
    const type = typeof value;
    return type === "string" || type === "number" || type === "boolean";
  });
}

function summaryLine(slug: string, input: unknown) {
  if (!isRecord(input)) return "";
  switch (slug) {
    case "read":
    case "write":
    case "edit":
      return typeof input.path === "string" ? pathBasename(input.path) : "";
    case "ls": {
      if (typeof input.path !== "string" || input.path === "" || input.path === ".") return ".";
      return pathBasename(input.path) || input.path;
    }
    case "grep":
    case "find": {
      const bits: string[] = [];
      if (typeof input.path === "string") bits.push(input.path);
      if (typeof input.pattern === "string") bits.push(`pattern=${input.pattern}`);
      if (slug === "grep" && typeof input.glob === "string") bits.push(`include=${input.glob}`);
      return bits.join(" ");
    }
    case "bash":
      return bashCommand(input).replace(/\s+/g, " ").trim();
    case "computer":
    case "sandboxInfo":
      return "";
    default:
      return isShallowDisplayable(input)
        ? shallowEntries(input).map(([key, value]) => `${key}=${formatPrimitive(value)}`).join(" ")
        : "";
  }
}

export function toolHeader({
  type,
  toolName,
  input,
  streaming,
  failed,
}: {
  type: string;
  toolName?: string;
  input: unknown;
  streaming: boolean;
  failed: boolean;
}): ToolHeader {
  const slug = toolSlug(type, toolName);
  const path = isRecord(input) && typeof input.path === "string" ? input.path : undefined;

  if (slug === "edit" || slug === "write") {
    return {
      slug,
      label: fileOperationLabel(slug, streaming, failed),
      summary: path ? pathBasename(path) : "",
      path,
      explore: false,
    };
  }

  if (slug === "bash") {
    return {
      slug,
      label: bashHeaderLabel(input),
      summary: summaryLine(slug, input),
      explore: false,
    };
  }

  return {
    slug,
    label: slug === "computer" ? "Screen recording" : displayToolLabel(slug),
    summary: summaryLine(slug, input),
    path,
    explore: !PRIMARY_TOOL_SLUGS.has(slug),
  };
}

/** "Explored" group subtitle: the distinct tools it collapsed, in order. */
export function exploreGroupSummary(labels: readonly string[]) {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts]
    .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
    .join(", ");
}
