"use client";

import {
  MultiFileDiff,
  PatchDiff,
  Virtualizer,
  WorkerPoolContextProvider,
  type FileContents,
} from "@pierre/diffs/react";
import { DEFAULT_THEMES, type FileDiffOptions, type ThemeTypes } from "@pierre/diffs";
import { useTheme } from "next-themes";
import { useMemo, type ReactNode } from "react";

const MAX_RENDERED_CHANGED_LINES = 500;

function changedLineCount(patch?: string): number {
  if (!patch) return 0;
  let count = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) count += 1;
    if (line.startsWith("-") && !line.startsWith("---")) count += 1;
  }
  return count;
}

function PierreDiffProviders({ children }: { children: ReactNode }) {
  const poolOptions = useMemo(
    () => ({
      workerFactory: () =>
        new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
          type: "module",
        }),
      poolSize: 2,
    }),
    [],
  );

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={{
        langs: [
          "text",
          "ts",
          "tsx",
          "js",
          "jsx",
          "json",
          "md",
          "css",
          "html",
          "bash",
          "python",
          "go",
          "rust",
        ],
        theme: DEFAULT_THEMES,
        preferredHighlighter: "shiki-wasm",
        lineDiffType: "none",
        maxLineDiffLength: 1000,
      }}
    >
      <Virtualizer className="min-h-0">{children}</Virtualizer>
    </WorkerPoolContextProvider>
  );
}

export function PierreDiffView({
  patch,
  fileName,
  oldContent,
  newContent,
}: {
  patch?: string;
  fileName?: string;
  oldContent?: string | null;
  newContent: string;
}) {
  const { resolvedTheme } = useTheme();
  const themeType: ThemeTypes = resolvedTheme === "dark" ? "dark" : "light";

  const diffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      theme: DEFAULT_THEMES,
      themeType,
      disableLineNumbers: false,
      overflow: "wrap",
      diffStyle: "unified",
      diffIndicators: "bars",
      lineHoverHighlight: "both",
      disableBackground: false,
      expansionLineCount: 20,
      hunkSeparators: "line-info-basic",
      lineDiffType: "none",
      maxLineDiffLength: 1000,
      tokenizeMaxLineLength: 1000,
      disableFileHeader: true,
    }),
    [themeType],
  );

  const changes = changedLineCount(patch);
  const tooLarge = changes > MAX_RENDERED_CHANGED_LINES;

  if (tooLarge) {
    return (
      <div className="border border-border/60 bg-muted/20 px-4 py-5 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Large diff</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          This change has {changes.toLocaleString()} changed lines. Rendering is paused to keep the thread responsive.
        </p>
      </div>
    );
  }

  const before = {
    name: fileName ?? "before.txt",
    contents: oldContent ?? "",
  } satisfies FileContents;
  const after = {
    name: fileName ?? "after.txt",
    contents: newContent,
  } satisfies FileContents;

  return (
    <PierreDiffProviders>
      <div className="pierre-diff-view min-w-0 overflow-hidden">
        {patch ? (
          <PatchDiff patch={patch} options={diffOptions} />
        ) : (
          <MultiFileDiff oldFile={before} newFile={after} options={diffOptions} />
        )}
      </div>
    </PierreDiffProviders>
  );
}
