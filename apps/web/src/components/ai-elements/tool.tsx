import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@autopr/ui/components/collapsible";
import { cn } from "@autopr/ui/lib/utils";
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { ChevronRight } from "lucide-react";
import type { BundledLanguage } from "shiki";
import type { ComponentProps, ReactNode } from "react";
import { Fragment, isValidElement, useCallback, useEffect, useState } from "react";

import {
  computerContentOutputToContentDetails,
  isDemoRecordingMetadata,
  type DemoRecordingMetadata,
} from "@/lib/chat-messages";
import { CodeBlock } from "./code-block";
import { PierreDiffView, usePierreDiffPreferences } from "./pierre-diff-view";
import { Shimmer } from "./shimmer";

const PLAIN_TEXT_LANG = "text" as BundledLanguage;
const STREAMING_CODE_PREVIEW_MAX_CHARS = 80_000;

const LANGUAGE_BY_BASENAME: Record<string, BundledLanguage> = {
  ".env": "dotenv",
  "dockerfile": "dockerfile",
  "makefile": "makefile",
};

const LANGUAGE_BY_EXTENSION: Record<string, BundledLanguage> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  dockerfile: "dockerfile",
  env: "dotenv",
  fish: "fish",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  yaml: "yaml",
  yml: "yaml",
  zsh: "zsh",
};

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({
  className,
  defaultOpen,
  onOpenChange,
  open: openProp,
  ...props
}: ToolProps) => {
  const [open, setOpen] = useControllableState({
    defaultProp: defaultOpen ?? false,
    prop: openProp,
  });

  const handleOpenChange = useCallback<NonNullable<ToolProps["onOpenChange"]>>(
    (nextOpen, eventDetails) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen, eventDetails);
    },
    [onOpenChange, setOpen]
  );

  return (
    <Collapsible
      className={cn(
        "group w-full min-w-0 overflow-hidden text-left font-mono text-[11px] leading-tight text-muted-foreground/70",
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
const PRIMARY_TOOL_SLUGS = new Set(["edit", "write", "bash", "computer"]);

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

function languageFromPath(path: unknown): BundledLanguage {
  if (typeof path !== "string") {
    return PLAIN_TEXT_LANG;
  }

  const basename = pathBasename(path).toLowerCase();
  if (basename === ".env" || basename.startsWith(".env.")) {
    return "dotenv";
  }
  if (basename === "dockerfile" || basename.startsWith("dockerfile.")) {
    return "dockerfile";
  }

  const basenameLanguage = LANGUAGE_BY_BASENAME[basename];
  if (basenameLanguage) {
    return basenameLanguage;
  }

  const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".") + 1) : "";
  return LANGUAGE_BY_EXTENSION[extension] ?? PLAIN_TEXT_LANG;
}

function languageFromCode(code: string): BundledLanguage {
  const trimmed = code.trimStart();
  if (!trimmed) {
    return PLAIN_TEXT_LANG;
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  if (/^#!.*\b(?:bash|sh|zsh)\b/.test(firstLine)) {
    return "bash";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  if (/^</.test(trimmed) && /<\/?[a-z][\s>/]/i.test(trimmed)) {
    return "html";
  }
  if (
    /\b(?:export|import)\s+(?:type\s+)?[\w{*]/.test(trimmed) ||
    /\b(?:const|let|interface|type)\s+\w/.test(trimmed)
  ) {
    return "typescript";
  }
  if (/^[\w.-]+:\s+\S/m.test(trimmed) && !/[;{}]/.test(trimmed.slice(0, 500))) {
    return "yaml";
  }

  return PLAIN_TEXT_LANG;
}

function languageFromPathOrCode(path: unknown, code: string): BundledLanguage {
  const pathLanguage = languageFromPath(path);
  return pathLanguage === PLAIN_TEXT_LANG ? languageFromCode(code) : pathLanguage;
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
    case "computer": {
      return "";
    }
    default:
      if (isShallowDisplayable(o)) {
        return shallowEntries(o)
          .map(([k, v]) => `${k}=${formatPrimitive(v)}`)
          .join(" ");
      }
      return "";
  }
}

function bashCommandFromInput(input: unknown): string {
  if (!isRecord(input)) {
    return "";
  }

  return typeof input.command === "string" ? input.command.trim() : "";
}

function bashHeaderLabel(input: unknown): string {
  const command = bashCommandFromInput(input);
  const normalized = command.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Run shell command";
  }

  if (/\b(vite|dev)\b/.test(normalized) && /\b(run|npm|pnpm|bun|yarn)\b/.test(normalized)) {
    return "Start dev server";
  }

  if (/\bcheck-types\b/.test(normalized)) {
    return "Run typecheck";
  }

  if (/\b(test|vitest|jest|playwright)\b/.test(normalized)) {
    return "Run tests";
  }

  if (/^(cat|sed|nl|tail|head)\b/.test(normalized)) {
    return "Read file";
  }

  if (/^(rg|grep|find)\b/.test(normalized)) {
    return "Search files";
  }

  if (/^(ls|pwd|git status)\b/.test(normalized)) {
    return "Inspect workspace";
  }

  return "Run shell command";
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

function computerActionTypes(input: unknown): string[] {
  if (!isRecord(input)) {
    return [];
  }

  const actionTypes: string[] = [];

  if (Array.isArray(input.actions)) {
    for (const action of input.actions) {
      if (isRecord(action) && typeof action.type === "string") {
        actionTypes.push(action.type);
      }
    }
  }

  if (typeof input.action === "string") {
    actionTypes.push(input.action);
  }

  if (typeof input.type === "string") {
    actionTypes.push(input.type);
  }

  return actionTypes;
}

function outputHasDemoRecording(output: unknown): boolean {
  const contentDetails = computerContentOutputToContentDetails(output);
  const details = contentDetails?.details ?? (isContentDetailsOutput(output) ? output.details : null);

  if (!details) {
    return false;
  }

  return demoRecordingsFromDetails(details).length > 0;
}

export function isComputerRecordingTool(
  input: unknown,
  output: unknown,
  state: ToolPart["state"],
): boolean {
  const actionTypes = computerActionTypes(input);
  const startsRecording = actionTypes.includes("start_recording");
  const stopsRecording = actionTypes.includes("stop_recording");

  if (startsRecording && !stopsRecording) {
    return state !== "output-available";
  }

  return (
    stopsRecording ||
    outputHasDemoRecording(output)
  );
}

function computerRecordingLabel(input: unknown, output: unknown, state: ToolPart["state"]): string {
  const actionTypes = computerActionTypes(input);
  const startsRecording = actionTypes.includes("start_recording");
  const stopsRecording = actionTypes.includes("stop_recording");

  if (
    state === "output-available" &&
    (stopsRecording || (!startsRecording && outputHasDemoRecording(output)))
  ) {
    return "Screen recorded";
  }

  return "Screen recording";
}

export type ToolDiffPayload = {
  renderer: "pierre";
  patch?: string;
  patchOmitted?: boolean;
  fileName?: string;
  status?: "added" | "deleted" | "modified";
  oldContent?: string | null;
  newContent?: string;
  /** True when the patch shows only the changed chunk, not the whole file. */
  truncated?: boolean;
};

export function isToolDiffPayload(v: unknown): v is ToolDiffPayload {
  if (!isRecord(v)) {
    return false;
  }

  if (v.renderer !== "pierre") {
    return false;
  }

  if ("patch" in v && typeof v.patch !== "string") {
    return false;
  }

  if ("patchOmitted" in v && typeof v.patchOmitted !== "boolean") {
    return false;
  }

  if (!("patch" in v) && typeof v.newContent !== "string") {
    return false;
  }

  if ("newContent" in v && typeof v.newContent !== "string") {
    return false;
  }

  if ("oldContent" in v && v.oldContent !== null && typeof v.oldContent !== "string") {
    return false;
  }

  if ("status" in v && v.status !== "added" && v.status !== "deleted" && v.status !== "modified") {
    return false;
  }

  if ("fileName" in v && typeof v.fileName !== "string") {
    return false;
  }

  if ("truncated" in v && typeof v.truncated !== "boolean") {
    return false;
  }

  return true;
}

function ToolDiffPartialNotice() {
  return (
    <div className="border border-border/60 bg-muted/20 px-3 py-1.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Partial diff — shows only the changed chunk of a large file
      </p>
    </div>
  );
}

export function ToolDiffView({
  diff,
  pathLine,
  onAddLineContext,
}: {
  diff: ToolDiffPayload;
  pathLine?: string;
  onAddLineContext?: (range: import("@pierre/diffs").SelectedLineRange) => void;
}) {
  const { diffStyle, lineDiffType } = usePierreDiffPreferences();

  if (diff.patchOmitted) {
    return (
      <div className="border border-border/60 bg-muted/20 px-4 py-5 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Diff omitted</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          This change was too large to keep inline. The file operation still completed.
        </p>
      </div>
    );
  }

  if (typeof diff.patch !== "string" || diff.patch.length === 0) {
    if (typeof diff.newContent !== "string") {
      return (
        <div className="border border-border/60 bg-muted/20 px-4 py-5 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Diff unavailable</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            The file changed, but no renderable diff payload was stored.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        {diff.truncated ? <ToolDiffPartialNotice /> : null}
        <PierreDiffView
          fileName={pathLine ?? diff.fileName}
          oldContent={diff.oldContent}
          newContent={diff.newContent}
          diffStyle={diffStyle}
          lineDiffType={lineDiffType}
          onAddLineContext={onAddLineContext}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {diff.truncated ? <ToolDiffPartialNotice /> : null}
      <div className="overflow-hidden">
        <PierreDiffView
          patch={diff.patch}
          fileName={pathLine ?? diff.fileName}
          oldContent={diff.oldContent}
          newContent={diff.newContent}
          diffStyle={diffStyle}
          lineDiffType={lineDiffType}
          onAddLineContext={onAddLineContext}
        />
      </div>
    </div>
  );
}

const RECORDING_PREPARE_RETRY_LIMIT = 18;
const RECORDING_PREPARE_RETRY_MIN_MS = 1_500;
const RECORDING_PREPARE_RETRY_MAX_MS = 7_000;

function appendSearchParams(url: string, params: Record<string, string>) {
  const hashIndex = url.indexOf("#");
  const baseUrl = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const separator = baseUrl.includes("?") ? "&" : "?";

  return `${baseUrl}${separator}${new URLSearchParams(params).toString()}${hash}`;
}

function recordingPrepareDelay(attempt: number) {
  return Math.min(
    RECORDING_PREPARE_RETRY_MIN_MS + attempt * 1_000,
    RECORDING_PREPARE_RETRY_MAX_MS,
  );
}

function cleanRecordingText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : undefined;
}

function titleFromRecordingFileName(fileName: string | undefined): string | undefined {
  const baseName = fileName?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
  const words = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (!words || /^[a-f0-9]{8,}$/i.test(words.replace(/\s+/g, ""))) {
    return undefined;
  }

  return words.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function recordingDisplayTitle(recording: DemoRecordingMetadata) {
  return (
    cleanRecordingText(recording.title) ??
    titleFromRecordingFileName(recording.fileName) ??
    "Demo Walkthrough"
  );
}

function formatRecordingDuration(seconds: number) {
  const roundedSeconds = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function recordingMetaLine(recording: DemoRecordingMetadata) {
  const details: string[] = [];

  if (typeof recording.durationSeconds === "number") {
    details.push(formatRecordingDuration(recording.durationSeconds));
  }

  if (recording.status && recording.status !== "completed") {
    details.push(recording.status);
  }

  return details.length > 0 ? details.join(" - ") : null;
}

function recordingPlaybackUrl(recording: DemoRecordingMetadata, recordingPlaybackBasePath?: string) {
  const explicitUrl = cleanRecordingText(recording.url);
  if (explicitUrl) {
    return explicitUrl;
  }

  const recordingId = cleanRecordingText(recording.id);
  if (!recordingId || !recordingPlaybackBasePath) {
    return undefined;
  }

  return appendSearchParams(recordingPlaybackBasePath, {
    recordingId,
  });
}

function DemoRecordingCard({
  recording,
  recordingPlaybackBasePath,
}: {
  recording: DemoRecordingMetadata;
  recordingPlaybackBasePath?: string;
}) {
  // react-doctor-disable-next-line react-doctor/rerender-state-only-in-handlers -- The retry counter intentionally re-runs the preparation effect after a user retry.
  const [prepareAttempt, setPrepareAttempt] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const title = recordingDisplayTitle(recording);
  const metaLine = recordingMetaLine(recording);
  const previewEndpoint = recordingPlaybackUrl(recording, recordingPlaybackBasePath);

  // react-doctor-disable-next-line react-doctor/no-fetch-in-effect -- Recording preparation is a browser-only playback side effect tied to this card.
  useEffect(() => {
    if (!previewEndpoint) {
      return;
    }

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const prepareRecording = async (attempt: number) => {
      setPlaybackUrl(null);
      setPrepareFailed(false);

      try {
        const response = await fetch(
          appendSearchParams(previewEndpoint, {
            prepare: "1",
            retry: String(prepareAttempt),
            attempt: String(attempt),
          }),
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        const data = await response.json().catch(() => null);
        const error = isRecord(data) && typeof data.error === "string"
          ? data.error
          : "Recording is still preparing.";
        const nextPlaybackUrl = isRecord(data) && typeof data.url === "string"
          ? data.url.trim()
          : "";

        if (!response.ok || !nextPlaybackUrl) {
          throw new Error(error);
        }

        if (!cancelled) {
          setPlaybackUrl(nextPlaybackUrl);
          setPrepareFailed(false);
        }
      } catch {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        if (attempt < RECORDING_PREPARE_RETRY_LIMIT) {
          retryTimeout = setTimeout(() => {
            void prepareRecording(attempt + 1);
          }, recordingPrepareDelay(attempt));
          return;
        }

        setPrepareFailed(true);
      }
    };

    void prepareRecording(0);

    return () => {
      cancelled = true;
      controller.abort();

      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [prepareAttempt, previewEndpoint]);

  const retryVideoLoad = useCallback(() => {
    setPlaybackUrl(null);
    setPrepareFailed(false);
    setPrepareAttempt((current) => current + 1);
  }, []);

  return (
    <article className="overflow-hidden rounded-md border border-border/60 bg-background">
      {previewEndpoint ? (
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {playbackUrl ? (
            // react-doctor-disable-next-line react-doctor/media-has-caption -- Daytona screen recordings do not include caption tracks.
            <video
              key={playbackUrl}
              aria-label={title}
              className="size-full bg-black object-contain"
              controls
              controlsList="nodownload"
              onError={retryVideoLoad}
              playsInline
              preload="auto"
              src={playbackUrl}
            />
          ) : null}
          <div className="pointer-events-none absolute left-3 right-3 top-3 z-10">
            <h4 className="w-fit max-w-full truncate rounded bg-black/55 px-2 py-1 text-[12px] font-medium leading-none text-white/90 backdrop-blur-sm">
              {title}
            </h4>
          </div>
          {!playbackUrl ? (
            <span className="sr-only">Preparing recording preview.</span>
          ) : null}
          {prepareFailed ? (
            <button
              type="button"
              className="absolute bottom-3 right-3 z-10 rounded bg-black/55 px-2 py-1 font-sans text-[11px] leading-none text-white/75 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70"
              onClick={retryVideoLoad}
            >
              Retry preview
            </button>
          ) : null}
        </div>
      ) : (
        <div className="px-3 py-2 font-sans text-[12px] leading-relaxed text-muted-foreground">
          Recording metadata is available, but no playback URL was attached.
        </div>
      )}
      {metaLine ? (
        <p className="border-t border-border/50 px-3 py-2 font-sans text-[12px] leading-none text-muted-foreground/80">
          {metaLine}
        </p>
      ) : null}
    </article>
  );
}

function demoRecordingsFromDetails(details: Record<string, unknown>) {
  const recordings: DemoRecordingMetadata[] = [];
  const seenRecordingIds = new Set<string>();

  const addRecording = (recording: DemoRecordingMetadata) => {
    if (seenRecordingIds.has(recording.id)) {
      return;
    }

    seenRecordingIds.add(recording.id);
    recordings.push(recording);
  };

  if (isDemoRecordingMetadata(details.recording)) {
    addRecording(details.recording);
  }

  if (Array.isArray(details.recordings)) {
    for (const recording of details.recordings) {
      if (isDemoRecordingMetadata(recording)) {
        addRecording(recording);
      }
    }
  }

  return recordings;
}

function ContentDetailsBody({
  slug,
  content,
  details,
  recordingPlaybackBasePath,
}: {
  slug: string;
  content: string;
  details: Record<string, unknown>;
  recordingPlaybackBasePath?: string;
}) {
  const meta = formatDetailsMetaLine(slug, details);
  const pathLine =
    typeof details.path === "string" ? (details.path as string) : undefined;
  const diffPayload =
    (slug === "write" || slug === "edit") && isToolDiffPayload(details.diff)
      ? details.diff
      : null;
  const showMeta = !diffPayload;

  if (slug === "computer") {
    return null;
  }

  if (slug === "bash") {
    return content.trim().length > 0 ? (
      <div className="max-h-[min(40vh,320px)] overflow-auto">
        <CodeBlock
          className="rounded-none border-0 bg-transparent text-muted-foreground [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!text-inherit [&_code]:!text-[12px] [&_code]:!leading-relaxed dark:[&_pre]:!bg-transparent dark:[&_pre]:!text-inherit"
          code={content}
          language={PLAIN_TEXT_LANG}
        />
      </div>
    ) : (
      <div className="font-sans text-[12px] leading-relaxed text-muted-foreground/60">No output</div>
    );
  }

  return (
    <div className="space-y-1.5">
      {showMeta && pathLine ? (
        <p className="break-all text-[10px] leading-snug text-muted-foreground/80">{pathLine}</p>
      ) : null}
      {showMeta && meta && (!pathLine || meta !== pathLine) ? (
        <p className="text-[10px] leading-snug text-muted-foreground/80">{meta}</p>
      ) : null}
      {diffPayload ? (
        <ToolDiffView diff={diffPayload} pathLine={pathLine} />
      ) : (
        <div className="max-h-[min(55vh,520px)] overflow-auto border border-border/50">
          <CodeBlock code={content} language={PLAIN_TEXT_LANG} />
        </div>
      )}
    </div>
  );
}

export type ToolRecordingOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  recordingPlaybackBasePath?: string;
};

export const ToolRecordingOutput = ({
  className,
  output,
  recordingPlaybackBasePath,
  ...props
}: ToolRecordingOutputProps) => {
  const computerContentDetails = computerContentOutputToContentDetails(output);
  const details = computerContentDetails?.details;

  if (!details) {
    return null;
  }

  const demoRecordings = demoRecordingsFromDetails(details);

  if (demoRecordings.length === 0) {
    return null;
  }

  return (
    <section className={cn("mt-1.5 space-y-1.5 font-sans", className)} {...props}>
      <h3 className="text-[13px] font-medium leading-tight text-muted-foreground">
        Walkthrough
      </h3>
      {demoRecordings.map((recording) => (
        <DemoRecordingCard
          key={recording.id}
          recording={recording}
          recordingPlaybackBasePath={recordingPlaybackBasePath}
        />
      ))}
    </section>
  );
};

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
        warn && "text-[color:var(--cohere-coral)]",
        bad && "text-destructive"
      )}
    >
      {label}
    </span>
  );
}

const getStatusBadge = (status: ToolPart["state"]) => (
  <ToolStatusText state={status} />
);

export type ToolHeaderProps = {
  title?: string;
  className?: string;
  input?: unknown;
  output?: unknown;
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
  output,
  ...props
}: ToolHeaderProps) => {
  const slug = toolSlugFromPart(type, type === "dynamic-tool" ? toolName : undefined);
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");
  const fallbackName = title ?? derivedName;
  const label = slug === "computer"
    ? computerRecordingLabel(input, output, state)
    : slug === "bash"
      ? bashHeaderLabel(input)
    : title ? fallbackName : displayToolLabel(slug);
  const summary = slug === "bash" ? "" : formatToolSummaryLine(slug, input);
  const streaming = isToolStreamingState(state);
  const recordingHeader = slug === "computer";
  const lineText = [label, summary].filter(Boolean).join(" ");
  const status = <ToolStatusText state={state} />;

  if (slug === "bash") {
    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left outline-none",
          "font-sans text-[13px] font-medium tracking-tight text-foreground/80",
          "transition-colors hover:text-foreground",
          "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          "group-data-open:border-b group-data-open:border-border/60",
          className
        )}
        {...props}
      >
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-data-open:rotate-90 motion-reduce:transition-none"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 overflow-hidden text-left">
          {streaming ? (
            <Shimmer
              as="span"
              className="block max-w-full truncate align-baseline"
              duration={2}
              spread={2}
            >
              {label}
            </Shimmer>
          ) : (
            <span className="block truncate">{label}</span>
          )}
        </span>
        {status}
        <span className="sr-only">
          {fallbackName}, {statusLabel[state]}. Toggle for arguments and result.
        </span>
      </CollapsibleTrigger>
    );
  }

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring",
        recordingHeader
          ? "border-l border-destructive/35 bg-muted/15 px-3 py-2 transition-colors hover:bg-muted/25"
          : "py-0.5",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 overflow-hidden text-left">
        {streaming ? (
          <Shimmer
            as="span"
            className={cn(
              "block max-w-full truncate align-baseline text-[11px]",
              recordingHeader && "font-sans text-[12px]"
            )}
            duration={2}
            spread={2}
          >
            {lineText || label}
          </Shimmer>
        ) : (
          <span className={cn(
            "flex min-w-0 gap-1.5",
            recordingHeader ? "items-center font-sans" : "items-baseline"
          )}>
            {recordingHeader ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-destructive/75"
                aria-hidden="true"
              />
            ) : null}
            <span className={cn(
              "shrink-0 font-medium text-muted-foreground",
              recordingHeader && "text-[12px] text-foreground/75"
            )}>
              {label}
            </span>
            {summary ? (
              <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground/70">{summary}</span>
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
      "mt-1 pt-1.5 text-[11px] text-muted-foreground/70 outline-none",
      "data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-top-1",
      "data-open:animate-in data-open:slide-in-from-top-1",
      "group-data-[tool=bash]:m-0 group-data-[tool=bash]:space-y-0 group-data-[tool=bash]:p-0",
      "motion-reduce:animate-none",
      className
    )}
    {...props}
  />
);

function trimStreamingPreviewIndent(code: string) {
  const lines = code.replace(/\r\n/g, "\n").split("\n");

  while (lines[0]?.trim() === "") {
    lines.shift();
  }
  while (lines.at(-1)?.trim() === "") {
    lines.pop();
  }

  const indentedLines = lines.filter((line) => line.trim().length > 0);
  if (indentedLines.length === 0) {
    return "";
  }

  const commonIndent = Math.min(
    ...indentedLines.map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0)
  );

  if (commonIndent === 0) {
    return lines.join("\n");
  }

  return lines
    .map((line) => (line.trim().length > 0 ? line.slice(commonIndent) : ""))
    .join("\n");
}

function streamingPreviewCode(code: string) {
  const trimmedCode = trimStreamingPreviewIndent(code);
  return {
    code: trimmedCode.slice(0, STREAMING_CODE_PREVIEW_MAX_CHARS),
    truncated: trimmedCode.length > STREAMING_CODE_PREVIEW_MAX_CHARS,
  };
}

function StreamingCodePreview({
  className,
  code,
  language,
  path,
  title,
}: {
  className?: string;
  code: string;
  language: BundledLanguage;
  path?: string;
  title: string;
}) {
  const preview = streamingPreviewCode(code);

  return (
    <section
      className={cn(
        "overflow-hidden border border-border/60 bg-card text-foreground",
        className
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2 border-b border-border/50 bg-muted/20 px-2.5 py-1.5 font-sans">
        <h4 className="shrink-0 text-[11px] font-medium leading-none text-muted-foreground">
          {title}
        </h4>
        {path ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] leading-none text-muted-foreground/65">
            {path}
          </span>
        ) : null}
      </div>
      <div className="max-h-[min(55vh,520px)] overflow-auto">
        <CodeBlock
          className="rounded-none border-0 bg-transparent text-foreground"
          code={preview.code}
          codeClassName="text-[12px] leading-[19px]"
          colorPalette="diff"
          language={language}
          preClassName="bg-transparent p-2 text-[12px] leading-[19px] text-foreground/90"
          useShikiBackground={false}
        />
      </div>
      {preview.truncated ? (
        <p className="border-t border-border/50 bg-muted/10 px-2.5 py-1.5 font-sans text-[11px] leading-snug text-muted-foreground/70">
          Streaming preview truncated.
        </p>
      ) : null}
    </section>
  );
}

function writeContentFromInput(input: unknown): string | null {
  if (!isRecord(input) || typeof input.content !== "string") {
    return null;
  }

  return input.content;
}

function pathFromToolInput(input: unknown): string | undefined {
  if (!isRecord(input) || typeof input.path !== "string") {
    return undefined;
  }

  return input.path;
}

function editPreviewsFromInput(input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.edits)) {
    return [];
  }

  return input.edits.flatMap((edit, index) => {
    if (!isRecord(edit)) {
      return [];
    }

    if (typeof edit.newText === "string") {
      return [
        {
          code: edit.newText,
          index,
          title: `Replacement ${index + 1}`,
        },
      ];
    }

    return [];
  });
}

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
  state?: ToolPart["state"];
  toolType?: string;
  toolName?: string;
};

export const ToolInput = ({
  className,
  input,
  state,
  toolType = "",
  toolName,
  ...props
}: ToolInputProps) => {
  const slug = toolSlugFromPart(toolType, toolName);
  if ((slug === "write" || slug === "edit") && state !== "output-available") {
    const path = pathFromToolInput(input);
    if (slug === "write") {
      const content = writeContentFromInput(input);

      return content !== null ? (
        <div className={className} {...props}>
          <StreamingCodePreview
            code={content}
            language={languageFromPathOrCode(path, content)}
            path={path}
            title="Writing"
          />
        </div>
      ) : null;
    }

    const editPreviews = editPreviewsFromInput(input);

    return editPreviews.length > 0 ? (
      <div className={cn("space-y-3", className)} {...props}>
        {editPreviews.map((preview) => (
          <StreamingCodePreview
            key={preview.index}
            code={preview.code}
            language={languageFromPathOrCode(path, preview.code)}
            path={path}
            title={preview.title}
          />
        ))}
      </div>
    ) : null;
  }

  if (slug === "write" || slug === "edit" || slug === "computer") {
    return null;
  }

  if (slug === "bash") {
    const command = bashCommandFromInput(input);

    if (!command) {
      return null;
    }

    return (
      <div className={cn("px-3.5 pt-3", className)} {...props}>
        <div className="flex min-w-0 items-start gap-2 font-mono text-[12px] leading-relaxed text-muted-foreground">
          <span className="shrink-0 select-none text-muted-foreground/55">$</span>
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-words bg-transparent p-0 text-[inherit] leading-[inherit]">
            {command}
          </code>
        </div>
      </div>
    );
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
  recordingPlaybackBasePath?: string;
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  toolType = "",
  toolName,
  recordingPlaybackBasePath,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    const slug = toolSlugFromPart(toolType, toolName);
    if (slug !== "bash") {
      return null;
    }
  }

  const slug = toolSlugFromPart(toolType, toolName);
  const computerContentDetails = slug === "computer" ? computerContentOutputToContentDetails(output) : null;

  if (!errorText && computerContentDetails) {
    return null;
  }

  let body: ReactNode;

  if (errorText) {
    body = <div className="py-0.5 text-[12px] leading-relaxed text-destructive">{errorText}</div>;
  } else if (slug === "bash" && !output) {
    body = <div className="font-sans text-[12px] leading-relaxed text-muted-foreground/60">No output</div>;
  } else if (computerContentDetails) {
    body = (
      <ContentDetailsBody
        slug={slug}
        content={computerContentDetails.content}
        details={computerContentDetails.details}
        recordingPlaybackBasePath={recordingPlaybackBasePath}
      />
    );
  } else if (isContentDetailsOutput(output)) {
    body = (
      <ContentDetailsBody
        slug={slug}
        content={output.content}
        details={output.details}
        recordingPlaybackBasePath={recordingPlaybackBasePath}
      />
    );
  } else if (typeof output === "object" && !isValidElement(output)) {
    body = (
      <div className="[&_pre]:rounded-none [&_pre]:border-0 [&_pre]:bg-transparent">
        <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
      </div>
    );
  } else if (typeof output === "string") {
    body = (
      <div className="[&_pre]:rounded-none [&_pre]:border-0 [&_pre]:bg-transparent">
        <CodeBlock
          className={cn(
            slug === "bash" &&
              "rounded-none border-0 bg-transparent text-muted-foreground [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!text-inherit [&_code]:!text-[12px] [&_code]:!leading-relaxed dark:[&_pre]:!bg-transparent dark:[&_pre]:!text-inherit"
          )}
          code={output}
          language={slug === "bash" ? PLAIN_TEXT_LANG : "json"}
        />
      </div>
    );
  } else {
    body = <div>{output as ReactNode}</div>;
  }

  return (
    <div
      className={cn(
        "mt-1.5 space-y-0.5 pt-1",
        slug === "bash" && "m-0 px-3.5 pb-3 pt-2.5",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "overflow-x-auto [&_table]:w-full",
          slug === "bash" ? "text-[12px]" : "text-[13px]",
          errorText ? "text-destructive" : slug === "bash" ? "text-muted-foreground" : "text-foreground/80",
        )}
      >
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
    <div className="flex items-center gap-2 py-0.5 font-mono text-[11px] leading-tight text-muted-foreground/60">
      {streaming ? (
        <Shimmer as="span" className="block max-w-full truncate align-baseline" duration={2} spread={2}>
          {[label, summary].filter(Boolean).join(" ")}
        </Shimmer>
      ) : (
        <span className="flex min-w-0 items-baseline gap-1.5 truncate">
          <span className="shrink-0 font-medium text-muted-foreground/80">{label}</span>
          {summary ? (
            <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground/50">{summary}</span>
          ) : null}
        </span>
      )}
      <ToolStatusText state={state} />
    </div>
  );
};
