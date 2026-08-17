import { hasStringType, hasUndefinedType } from "@autopr/config/runtime-type";

import { Skeleton } from "@autopr/ui/components/skeleton";
import { cn } from "@autopr/ui/lib/utils";
import { Check, CheckCheck, Columns2, ExternalLink, FileCode2, List, RefreshCw, TextWrap } from "lucide-react";
import { useEffect, useState } from "react";

import { PierreDiffView, PierreDiffWorkerPoolProvider, usePierreDiffPreferences } from "#/components/ai-elements/pierre-diff-view";
import { FileTypeIcon, pathParts } from "#/lib/file-type-icon";
import { type ProjectPullRequestFile, useProjectPullRequestFiles } from "#/lib/project-pull-requests";

function filePatch(file: ProjectPullRequestFile) {
  if (!file.patch) return undefined;
  const before = file.status === "added" ? "/dev/null" : `a/${file.previousFilename ?? file.filename}`;
  const after = file.status === "removed" ? "/dev/null" : `b/${file.filename}`;
  return `diff --git a/${file.previousFilename ?? file.filename} b/${file.filename}\n--- ${before}\n+++ ${after}\n${file.patch}`;
}

function reviewStorageKey(projectId: string, number: number) {
  return `autopr.pr-viewed-files.v1:${projectId}:${number}`;
}

function readReviewedFiles(projectId: string, number: number) {
  if (hasUndefinedType(globalThis.window)) return new Set<string>();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(reviewStorageKey(projectId, number)) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => hasStringType(value)) : []);
  } catch {
    return new Set<string>();
  }
}

function CodeGhost() {
  return (
    <div className="grid h-full grid-cols-[minmax(180px,28%)_minmax(0,1fr)]">
      <div className="space-y-3 border-r border-border p-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-9 rounded-xs" />)}</div>
      <div className="space-y-3 p-4"><Skeleton className="h-8 w-full rounded-xs" /><Skeleton className="h-64 w-full rounded-xs" /></div>
    </div>
  );
}

function CodeTabContent({ projectId, number }: { projectId: string; number: number }) {
  const query = useProjectPullRequestFiles(projectId, number);
  const { diffStyle, wordWrap, setDiffStyle, setWordWrap } = usePierreDiffPreferences();
  const [activeFile, setActiveFile] = useState<string>();
  const [reviewed, setReviewed] = useState<Set<string>>(() => readReviewedFiles(projectId, number));
  const files = query.data?.files ?? [];
  const selected = files.find((file) => file.filename === activeFile) ?? files[0];

  useEffect(() => {
    try {
      window.localStorage.setItem(reviewStorageKey(projectId, number), JSON.stringify([...reviewed]));
    } catch {
      // Review progress is a local convenience; storage failures do not block the diff.
    }
  }, [number, projectId, reviewed]);

  if (query.isPending) return <CodeGhost />;
  if (query.error) {
    return (
      <div className="m-5 border border-destructive/30 bg-destructive/[0.04] p-4" role="alert">
        <p className="text-sm font-medium text-destructive">Could not load changed files</p>
        <p className="mt-1 text-xs text-muted-foreground">{query.error.message}</p>
        <button type="button" onClick={() => void query.refetch()} className="mt-3 inline-flex h-7 items-center gap-1.5 border border-border px-2.5 text-xs text-foreground hover:bg-[color:var(--project-panel-soft)]"><RefreshCw className="size-3.5" aria-hidden="true" />Try again</button>
      </div>
    );
  }
  if (!selected) return <div className="grid h-full place-items-center p-8 text-sm text-muted-foreground">No changed files were reported.</div>;

  const reviewedCount = files.filter((file) => reviewed.has(file.filename)).length;
  const allReviewed = files.length > 0 && reviewedCount === files.length;
  const toggleReviewed = (filename: string) => setReviewed((current) => {
    const next = new Set(current);
    if (next.has(filename)) next.delete(filename);
    else next.add(filename);
    return next;
  });

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(180px,28%)_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
      <aside className="minimal-scrollbar min-h-0 overflow-y-auto border-r border-border bg-[color:color-mix(in_srgb,var(--project-panel-soft)_35%,transparent)] max-md:max-h-44 max-md:border-r-0 max-md:border-b">
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-2 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{reviewedCount}/{files.length} viewed</span>
            <button type="button" onClick={() => setReviewed(allReviewed ? new Set() : new Set(files.map((file) => file.filename)))} className="inline-flex items-center gap-1 hover:text-foreground">
              <CheckCheck className="size-3" aria-hidden="true" />{allReviewed ? "Reset" : "View all"}
            </button>
          </div>
          <div className="mt-2 h-0.5 overflow-hidden bg-border/70" role="progressbar" aria-label="Files viewed" aria-valuenow={reviewedCount} aria-valuemin={0} aria-valuemax={files.length}>
            <div className="h-full bg-[color:var(--project-selected-strong)] transition-[width]" style={{ width: `${files.length ? (reviewedCount / files.length) * 100 : 0}%` }} />
          </div>
        </div>
        {files.map((file) => {
          const { name, dir } = pathParts(file.filename);
          const viewed = reviewed.has(file.filename);
          return (
            <div key={file.filename} className={cn("group flex items-start gap-1 border-b border-border/55 pr-2", selected.filename === file.filename ? "bg-[color:var(--project-selected)]" : "hover:bg-[color:var(--project-panel-soft)]")}>
              <button type="button" onClick={() => toggleReviewed(file.filename)} aria-pressed={viewed} aria-label={`Mark ${file.filename} ${viewed ? "unviewed" : "viewed"}`} className={cn("ml-2 mt-2.5 inline-flex size-4 shrink-0 items-center justify-center border", viewed ? "border-[color:var(--project-selected-strong)] bg-[color:var(--project-selected-strong)] text-white" : "border-border bg-background text-transparent")}>
                <Check className="size-3" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setActiveFile(file.filename)} className="flex min-w-0 flex-1 items-start gap-2 py-2.5 text-left">
                <FileTypeIcon file={file.filename} className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 flex-1"><span className="block truncate font-mono text-[11px] text-foreground">{name}</span>{dir ? <span className="block truncate font-mono text-[9px] text-muted-foreground">{dir}</span> : null}</span>
                <span className="shrink-0 font-mono text-[9px] tabular-nums"><span className="text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]">+{file.additions}</span> <span className="text-[color:var(--cohere-coral)]">-{file.deletions}</span></span>
              </button>
            </div>
          );
        })}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col bg-background">
        <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <FileTypeIcon file={selected.filename} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={selected.filename}>{selected.filename}</span>
          <span className="font-mono text-[10px] text-[color:var(--cohere-deep-green)] dark:text-[color:var(--cohere-pale-green)]">+{selected.additions}</span>
          <span className="font-mono text-[10px] text-[color:var(--cohere-coral)]">-{selected.deletions}</span>
          <div className="ml-1 flex items-center border border-border">
            <button type="button" onClick={() => setDiffStyle("unified")} aria-pressed={diffStyle === "unified"} aria-label="Unified diff" className={cn("inline-flex size-7 items-center justify-center", diffStyle === "unified" ? "bg-[color:var(--project-panel-soft)] text-foreground" : "text-muted-foreground")}><List className="size-3.5" aria-hidden="true" /></button>
            <button type="button" onClick={() => setDiffStyle("split")} aria-pressed={diffStyle === "split"} aria-label="Split diff" className={cn("inline-flex size-7 items-center justify-center border-l border-border", diffStyle === "split" ? "bg-[color:var(--project-panel-soft)] text-foreground" : "text-muted-foreground")}><Columns2 className="size-3.5" aria-hidden="true" /></button>
          </div>
          <button type="button" onClick={() => setWordWrap(!wordWrap)} aria-pressed={wordWrap} aria-label="Toggle line wrapping" className={cn("inline-flex size-7 items-center justify-center border border-border", wordWrap ? "bg-[color:var(--project-panel-soft)] text-foreground" : "text-muted-foreground")}><TextWrap className="size-3.5" aria-hidden="true" /></button>
        </div>
        <div className="minimal-scrollbar min-h-0 flex-1 overflow-auto p-2">
          {selected.patch ? <PierreDiffView key={selected.filename} fileName={selected.filename} patch={filePatch(selected)} diffStyle={diffStyle} wordWrap={wordWrap} /> : (
            <div className="grid min-h-48 place-items-center border border-border bg-muted/20 p-8 text-center"><div><FileCode2 className="mx-auto size-5 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium text-foreground">Diff preview unavailable</p><p className="mt-1 text-xs text-muted-foreground">GitHub does not return inline patches for some binary or very large files.</p><a href={selected.blobUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-[color:var(--project-selected-strong)] hover:underline">Open file on GitHub <ExternalLink className="size-3" aria-hidden="true" /></a></div></div>
          )}
        </div>
      </section>
    </div>
  );
}

export function PullRequestCodeTab(props: { projectId: string; number: number }) {
  return <PierreDiffWorkerPoolProvider><CodeTabContent {...props} /></PierreDiffWorkerPoolProvider>;
}
