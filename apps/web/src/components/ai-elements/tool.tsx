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
        "group not-prose mb-3 w-full border border-teal-500/10 bg-background text-left",
        className
      )}
      onOpenChange={handleOpenChange}
      open={open}
      {...props}
    />
  );
};

export type ToolPart = ToolUIPart | DynamicToolUIPart;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** e.g. tool-read → read; dynamic-tool + name → name */
function toolSlugFromPart(type: string, toolName?: string): string {
  if (type === "dynamic-tool" && toolName) {
    return toolName;
  }
  const parts = type.split("-");
  if (parts[0] === "tool" && parts.length > 1) {
    return parts.slice(1).join("-");
  }
  return parts.slice(1).join("-") || type;
}

function pathBasename(path: string): string {
  const t = path.replace(/\/+$/, "") || path;
  const i = t.lastIndexOf("/");
  const n = i === -1 ? t : t.slice(i + 1);
  return n || "/";
}

function inputPath(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const p = input.path;
  return typeof p === "string" ? p : undefined;
}

function isContentDetailsOutput(
  v: unknown
): v is { content: string; details: Record<string, unknown> } {
  return isRecord(v) && typeof v.content === "string" && isRecord(v.details);
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

  return (
    <div className="space-y-2">
      {pathLine ? (
        <p className="break-all font-mono text-[10px] leading-snug text-muted-foreground">{pathLine}</p>
      ) : null}
      {meta && (!pathLine || meta !== pathLine) ? (
        <p className="font-mono text-[10px] leading-snug text-muted-foreground">{meta}</p>
      ) : null}
      <div className="max-h-[min(55vh,520px)] overflow-auto border border-border/70 bg-muted/15">
        <CodeBlock code={content} language={PLAIN_TEXT_LANG} />
      </div>
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
  const label = statusLabel[state];
  const muted =
    state === "output-available" ||
    state === "approval-responded" ||
    state === "input-streaming";
  const warn = state === "approval-requested" || state === "output-denied";
  const bad = state === "output-error";

  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.12em]",
        muted && "text-muted-foreground",
        warn && "text-amber-700/90 dark:text-amber-200/90",
        bad && "text-destructive",
        !muted &&
          !warn &&
          !bad &&
          "text-teal-700 dark:text-teal-400"
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
  const path = inputPath(input);

  let primary: ReactNode = (
    <>
      <span className="break-all">{fallbackName}</span>
    </>
  );

  if (!title) {
    if (slug === "read" && path) {
      primary = (
        <>
          <span className="text-muted-foreground">read file </span>
          <span>{pathBasename(path)}</span>
        </>
      );
    } else if (slug === "ls") {
      const p = path ?? ".";
      const label = p === "." || p === "" ? "." : pathBasename(p) || p;
      primary = (
        <>
          <span className="text-muted-foreground">list dir </span>
          <span>{label}</span>
        </>
      );
    }
  }

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-baseline justify-between gap-4 px-3 py-2.5 outline-none transition-colors hover:bg-muted/25 focus-visible:bg-muted/25 focus-visible:ring-2 focus-visible:ring-teal-500/25 focus-visible:ring-offset-0 sm:px-3.5",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 font-mono text-[13px] leading-snug text-foreground">
        {primary}
        <span className="text-muted-foreground"> · </span>
        <ToolStatusText state={state} />
      </span>
      <span
        className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
        aria-hidden="true"
      >
        <span className="group-data-[state=open]:hidden">+</span>
        <span className="hidden group-data-[state=open]:inline">−</span>
      </span>
      <span className="sr-only">
        {fallbackName}, {statusLabel[state]}. Toggle to show or hide arguments and result.
      </span>
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "border-t border-border/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
  /** Tool UI part `type`, e.g. `tool-read` */
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
  const asRecord = isRecord(input) ? input : null;
  const useKv = asRecord && isShallowDisplayable(asRecord);

  return (
    <div className={cn("space-y-1.5 px-3 pb-3 pt-2 sm:px-3.5", className)} {...props}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">in</p>
      {useKv ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 font-mono text-[11px] leading-snug">
          {shallowEntries(asRecord).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all text-foreground">{formatPrimitive(v)}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <div className="border border-border/70 bg-muted/20">
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
    body = (
      <div className="px-2.5 py-2 font-mono text-[12px] leading-relaxed">{errorText}</div>
    );
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
    <div className={cn("space-y-1.5 px-3 pb-3 pt-1 sm:px-3.5", className)} {...props}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {errorText ? "error" : "out"}
      </p>
      <div
        className={cn(
          "overflow-x-auto border text-xs [&_table]:w-full",
          errorText
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : isContentDetailsOutput(output) && !errorText
              ? "border-transparent bg-transparent"
              : "border-border/70 bg-muted/20 text-foreground"
        )}
      >
        {body}
      </div>
    </div>
  );
};
