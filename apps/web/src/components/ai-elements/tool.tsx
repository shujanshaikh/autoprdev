"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@autopr/ui/components/collapsible";
import { cn } from "@autopr/ui/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { BundledLanguage } from "shiki";
import type { ComponentProps, ReactNode } from "react";
import { Fragment, isValidElement, useCallback, useEffect, useState } from "react";

import { CodeBlock } from "./code-block";
import { ContentDiff } from "./content-diff";
import { Shimmer } from "./shimmer";

const PLAIN_TEXT_LANG = "text" as BundledLanguage;

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({
  className,
  defaultOpen,
  onOpenChange,
  open: openProp,
  ...props
}: ToolProps) => {
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const open = openProp ?? internalOpen;

  useEffect(() => {
    if (!isControlled) {
      setInternalOpen(defaultOpen ?? false);
    }
  }, [defaultOpen, isControlled]);

  const handleOpenChange = useCallback<NonNullable<ToolProps["onOpenChange"]>>(
    (nextOpen, eventDetails) => {
      if (!isControlled) {
        setInternalOpen(nextOpen);
      }

      onOpenChange?.(nextOpen, eventDetails);
    },
    [isControlled, onOpenChange]
  );

  return (
    <Collapsible
      className={cn(
        "group not-prose mb-0 w-full min-w-0 overflow-hidden text-left font-mono text-[11px] leading-tight text-muted-foreground",
        className
      )}
      onOpenChange={handleOpenChange}
      open={open}
      {...props}
    />
  );
};

export type ToolPart = ToolUIPart | DynamicToolUIPart;

function isToolStreamingState(state: ToolPart["state"]): boolean {
  return state === "input-streaming" || state === "input-available";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** e.g. tool-read → read; dynamic-tool + name → name */
export function toolSlugFromPart(type: string, toolName?: string): string {
  if (type === "dynamic-tool" && toolName) {
    return toolName;
  }
  const parts = type.split("-");
  if (parts[0] === "tool" && parts.length > 1) {
    return parts.slice(1).join("-");
  }
  return parts.slice(1).join("-") || type;
}

/** Primary tools that get full expandable rendering */
const PRIMARY_TOOL_SLUGS = new Set(["edit", "write", "bash"]);

/** Returns true if the tool is an "explore" tool (read-only, search, etc.) */
export function isExploreTool(type: string, toolName?: string): boolean {
  const slug = toolSlugFromPart(type, toolName);
  return !PRIMARY_TOOL_SLUGS.has(slug);
}

function pathBasename(path: string): string {
  const t = path.replace(/\/+$/, "") || path;
  const i = t.lastIndexOf("/");
  const n = i === -1 ? t : t.slice(i + 1);
  return n || "/";
}

function displayToolLabel(slug: string): string {
  if (slug === "find") {
    return "Glob";
  }
  if (!slug) {
    return "Tool";
  }
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function formatPrimitive(v: unknown): string {
  if (v === null) {
    return "null";
  }
  if (v === undefined) {
    return "";
  }
  if (typeof v === "object") {
    return JSON.stringify(v);
  }
  return String(v);
}

function shallowEntries(data: Record<string, unknown>): [string, unknown][] {
  return Object.entries(data).filter(([, v]) => v !== undefined);
}

function isShallowDisplayable(data: Record<string, unknown>): boolean {
  return shallowEntries(data).every(([, v]) => {
    if (v === null) {
      return true;
    }
    const t = typeof v;
    return t === "string" || t === "number" || t === "boolean";
  });
}

function formatToolSummaryLine(slug: string, input: unknown): string {
  if (!isRecord(input)) {
    return "";
  }
  const o = input;

  switch (slug) {
    case "read": {
      const p = o.path;
      return typeof p === "string" ? pathBasename(p) : "";
    }
    case "write":
    case "edit": {
      const p = o.path;
      return typeof p === "string" ? pathBasename(p) : "";
    }
    case "ls": {
      const p = o.path;
      if (typeof p !== "string" || p === "" || p === ".") {
        return ".";
      }
      return pathBasename(p) || p;
    }
    case "grep": {
      const bits: string[] = [];
      if (typeof o.path === "string") {
        bits.push(o.path);
      }
      if (typeof o.pattern === "string") {
        bits.push(`pattern=${o.pattern}`);
      }
      if (typeof o.glob === "string") {
        bits.push(`include=${o.glob}`);
      }
      return bits.join(" ");
    }
    case "find": {
      const bits: string[] = [];
      if (typeof o.path === "string") {
        bits.push(o.path);
      }
      if (typeof o.pattern === "string") {
        bits.push(`pattern=${o.pattern}`);
      }
      return bits.join(" ");
    }
    case "bash": {
      const c = o.command;
      return typeof c === "string" ? c.replace(/\s+/g, " ").trim() : "";
    }
    case "sandboxInfo":
      return "";
    default:
      if (isShallowDisplayable(o)) {
        return shallowEntries(o)
          .map(([k, v]) => `${k}=${formatPrimitive(v)}`)
          .join(" ");
      }
      return "";
  }
}

function formatReadDetailsMeta(d: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (typeof d.bytes === "number") {
    parts.push(`${d.bytes} B`);
  }
  if (
    typeof d.lineOffset === "number" &&
    typeof d.linesReturned === "number" &&
    typeof d.totalLines === "number"
  ) {
    const hi = d.lineOffset + d.linesReturned - 1;
    parts.push(`lines ${d.lineOffset}–${hi} of ${d.totalLines}`);
  }
  if (d.truncated === true) {
    parts.push("truncated");
  }
  if (d.isBinary === true) {
    parts.push("binary");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatLsDetailsMeta(d: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (typeof d.entries === "number") {
    parts.push(`${d.entries} entries`);
  }
  if (d.truncated === true) {
    parts.push("truncated");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatDetailsMetaLine(slug: string, details: Record<string, unknown>): string | null {
  if (slug === "read") {
    return formatReadDetailsMeta(details);
  }
  if (slug === "ls") {
    return formatLsDetailsMeta(details);
  }
  if (typeof details.path === "string") {
    return details.path;
  }
  return null;
}

function isContentDetailsOutput(
  v: unknown
): v is { content: string; details: Record<string, unknown> } {
  return isRecord(v) && typeof v.content === "string" && isRecord(v.details);
}

type ToolDiffPayload = {
  renderer: "pierre";
  patch?: string;
  fileName?: string;
  oldContent?: string | null;
  newContent: string;
};

function isToolDiffPayload(v: unknown): v is ToolDiffPayload {
  if (!isRecord(v)) {
    return false;
  }

  if (v.renderer !== "pierre") {
    return false;
  }

  if ("patch" in v && typeof v.patch !== "string") {
    return false;
  }

  if (typeof v.newContent !== "string") {
    return false;
  }

  if ("oldContent" in v && v.oldContent !== null && typeof v.oldContent !== "string") {
    return false;
  }

  if ("fileName" in v && typeof v.fileName !== "string") {
    return false;
  }

  return true;
}

function getShikiLangFromPath(path: string | undefined): BundledLanguage {
  if (!path) {
    return PLAIN_TEXT_LANG;
  }

  const file = path.split(/[\\/]/).pop() ?? path;
  const extension = file.includes(".") ? file.slice(file.lastIndexOf(".") + 1).toLowerCase() : "";

  if (extension === "ts") return "ts" as BundledLanguage;
  if (extension === "tsx") return "tsx" as BundledLanguage;
  if (extension === "js") return "js" as BundledLanguage;
  if (extension === "jsx") return "jsx" as BundledLanguage;
  if (extension === "json") return "json" as BundledLanguage;
  if (extension === "md") return "md" as BundledLanguage;
  if (extension === "mdx") return "mdx" as BundledLanguage;
  if (extension === "css") return "css" as BundledLanguage;
  if (extension === "scss") return "scss" as BundledLanguage;
  if (extension === "html") return "html" as BundledLanguage;
  if (extension === "yaml" || extension === "yml") return "yaml" as BundledLanguage;
  if (extension === "sh" || extension === "bash") return "bash" as BundledLanguage;
  if (extension === "py") return "python" as BundledLanguage;
  if (extension === "go") return "go" as BundledLanguage;
  if (extension === "rs") return "rust" as BundledLanguage;
  if (extension === "java") return "java" as BundledLanguage;
  if (extension === "kt") return "kotlin" as BundledLanguage;
  if (extension === "swift") return "swift" as BundledLanguage;
  if (extension === "vue") return "vue" as BundledLanguage;
  if (extension === "svelte") return "svelte" as BundledLanguage;
  if (extension === "xml") return "xml" as BundledLanguage;

  return PLAIN_TEXT_LANG;
}

function PierreDiffView({ diff, pathLine }: { diff: ToolDiffPayload; pathLine?: string }) {
  const language = getShikiLangFromPath(pathLine ?? diff.fileName);

  if (typeof diff.patch !== "string" || diff.patch.length === 0) {
    return (
      <div className="max-h-[min(55vh,520px)] overflow-auto border border-border/50">
        <CodeBlock code={diff.newContent} language={language} />
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      <ContentDiff diff={diff.patch} language={language} />
    </div>
  );
}

function ContentDetailsBody({
  slug,
  content,
  details,
}: {
  slug: string;
  content: string;
  details: Record<string, unknown>;
}) {
  const meta = formatDetailsMetaLine(slug, details);
  const pathLine =
    typeof details.path === "string" ? (details.path as string) : undefined;
  const diffPayload =
    (slug === "write" || slug === "edit") && isToolDiffPayload(details.diff)
      ? details.diff
      : null;
  const showMeta = !(slug === "edit" && diffPayload);

  return (
    <div className="space-y-1.5">
      {showMeta && pathLine ? (
        <p className="break-all text-[10px] leading-snug text-muted-foreground">{pathLine}</p>
      ) : null}
      {showMeta && meta && (!pathLine || meta !== pathLine) ? (
        <p className="text-[10px] leading-snug text-muted-foreground">{meta}</p>
      ) : null}
      {diffPayload ? (
        <PierreDiffView diff={diffPayload} pathLine={pathLine} />
      ) : (
        <div className="max-h-[min(55vh,520px)] overflow-auto border border-border/50">
          <CodeBlock code={content} language={PLAIN_TEXT_LANG} />
        </div>
      )}
    </div>
  );
}

const statusLabel: Record<ToolPart["state"], string> = {
  "approval-requested": "awaiting approval",
  "approval-responded": "approved",
  "input-available": "running",
  "input-streaming": "preparing",
  "output-available": "done",
  "output-denied": "denied",
  "output-error": "error",
};

function ToolStatusText({ state }: { state: ToolPart["state"] }) {
  if (state === "output-available" || isToolStreamingState(state)) {
    return null;
  }
  const label = statusLabel[state];
  const warn = state === "approval-requested" || state === "output-denied";
  const bad = state === "output-error";

  return (
    <span
      className={cn(
        "shrink-0 text-[10px] text-muted-foreground/80",
        warn && "text-amber-600 dark:text-amber-400",
        bad && "text-destructive"
      )}
    >
      {label}
    </span>
  );
}

export const getStatusBadge = (status: ToolPart["state"]) => (
  <ToolStatusText state={status} />
);

export type ToolHeaderProps = {
  title?: string;
  className?: string;
  input?: unknown;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  input,
  ...props
}: ToolHeaderProps) => {
  const slug = toolSlugFromPart(type, type === "dynamic-tool" ? toolName : undefined);
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");
  const fallbackName = title ?? derivedName;
  const label = title ? fallbackName : displayToolLabel(slug);
  const summary = formatToolSummaryLine(slug, input);
  const streaming = isToolStreamingState(state);
  const lineText = [label, summary].filter(Boolean).join(" ");
  const status = <ToolStatusText state={state} />;

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 py-0.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 overflow-hidden text-left">
        {streaming ? (
          <Shimmer as="span" className="block max-w-full truncate align-baseline text-[11px]" duration={2} spread={2}>
            {lineText || label}
          </Shimmer>
        ) : (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-medium text-foreground">{label}</span>
            {summary ? (
              <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">{summary}</span>
            ) : null}
          </span>
        )}
      </span>
      {status}
      <span className="sr-only">
        {fallbackName}, {statusLabel[state]}. Toggle for arguments and result.
      </span>
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-0.5 border-t border-border/40 pt-1.5 text-[11px] text-muted-foreground data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
  toolType?: string;
  toolName?: string;
};

export const ToolInput = ({
  className,
  input,
  toolType = "",
  toolName,
  ...props
}: ToolInputProps) => {
  const slug = toolSlugFromPart(toolType, toolName);
  if (slug === "edit") {
    return null;
  }

  const asRecord = isRecord(input) ? input : null;
  const useKv = asRecord && isShallowDisplayable(asRecord);

  return (
    <div className={cn("space-y-0.5", className)} {...props}>
      {useKv ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px] leading-snug">
          {shallowEntries(asRecord).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground/70">{k}</dt>
              <dd className="truncate text-foreground/90">{formatPrimitive(v)}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <div className="[&_pre]:bg-transparent">
          <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
        </div>
      )}
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
  toolType?: string;
  toolName?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  toolType = "",
  toolName,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  const slug = toolSlugFromPart(toolType, toolName);

  let body: ReactNode;

  if (errorText) {
    body = <div className="py-0.5 text-[11px] leading-relaxed text-destructive">{errorText}</div>;
  } else if (isContentDetailsOutput(output)) {
    body = <ContentDetailsBody slug={slug} content={output.content} details={output.details} />;
  } else if (typeof output === "object" && !isValidElement(output)) {
    body = (
      <div className="[&_pre]:rounded-none [&_pre]:border-0 [&_pre]:bg-transparent">
        <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
      </div>
    );
  } else if (typeof output === "string") {
    body = (
      <div className="[&_pre]:rounded-none [&_pre]:border-0 [&_pre]:bg-transparent">
        <CodeBlock code={output} language="json" />
      </div>
    );
  } else {
    body = <div>{output as ReactNode}</div>;
  }

  return (
    <div className={cn("mt-1.5 space-y-0.5 border-t border-border/40 pt-1.5", className)} {...props}>
      <div className={cn("overflow-x-auto text-xs [&_table]:w-full", errorText ? "text-destructive" : "text-foreground/90")}>
        {body}
      </div>
    </div>
  );
};

/* ─── Explore tool: lightweight non-expandable row ──────────────────── */

export type ExploreToolRowProps = {
  type: string;
  toolName?: string;
  input?: unknown;
  state: ToolPart["state"];
};

/** A single flat line for an explore tool — not expandable, just shows label + summary. */
export const ExploreToolRow = ({ type, toolName, input, state }: ExploreToolRowProps) => {
  const slug = toolSlugFromPart(type, type === "dynamic-tool" ? toolName : undefined);
  const label = displayToolLabel(slug);
  const summary = formatToolSummaryLine(slug, input);
  const streaming = isToolStreamingState(state);

  return (
    <div className="flex items-center gap-2 py-0.5 font-mono text-[11px] leading-tight text-muted-foreground">
      {streaming ? (
        <Shimmer as="span" className="block max-w-full truncate align-baseline" duration={2} spread={2}>
          {[label, summary].filter(Boolean).join(" ")}
        </Shimmer>
      ) : (
        <span className="flex min-w-0 items-baseline gap-1.5 truncate">
          <span className="shrink-0 font-medium text-foreground">{label}</span>
          {summary ? (
            <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">{summary}</span>
          ) : null}
        </span>
      )}
      <ToolStatusText state={state} />
    </div>
  );
};
