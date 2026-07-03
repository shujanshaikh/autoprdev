import {
  MultiFileDiff,
  PatchDiff,
  Virtualizer,
  WorkerPoolContextProvider,
  type FileContents,
} from "@pierre/diffs/react";
import { DEFAULT_THEMES, type FileDiffOptions, type ThemeTypes } from "@pierre/diffs";
import { useTheme } from "next-themes";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

// Diffs above this size mount one idle frame after first paint so the thread
// stays responsive while still showing the diff automatically.
const DEFERRED_RENDER_CHANGED_LINES = 500;
// Diffs above this size require an explicit click before rendering.
const MAX_AUTO_RENDERED_CHANGED_LINES = 5_000;
const DIFF_PREFERENCES_STORAGE_KEY = "autopr.diff.preferences.v1";

export type PierreDiffStyle = "unified" | "split";
export type PierreLineDiffType = "word-alt" | "none";

type PierreDiffPreferenceState = {
  diffStyle: PierreDiffStyle;
  lineDiffType: PierreLineDiffType;
};

type PierreDiffPreferences = PierreDiffPreferenceState & {
  similarChanges: boolean;
  setDiffStyle: (style: PierreDiffStyle) => void;
  setSimilarChanges: (enabled: boolean) => void;
};

const DEFAULT_DIFF_PREFERENCES: PierreDiffPreferenceState = {
  diffStyle: "unified",
  lineDiffType: "none",
};

const PierreDiffPreferencesContext = createContext<PierreDiffPreferences | undefined>(undefined);

function readStoredDiffPreferences(): PierreDiffPreferenceState {
  if (typeof window === "undefined") {
    return DEFAULT_DIFF_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(DIFF_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_DIFF_PREFERENCES;
    }

    const stored = JSON.parse(raw) as Partial<PierreDiffPreferenceState>;
    return {
      diffStyle: stored.diffStyle === "split" ? "split" : "unified",
      lineDiffType: stored.lineDiffType === "word-alt" ? "word-alt" : "none",
    };
  } catch {
    return DEFAULT_DIFF_PREFERENCES;
  }
}

const DIFF_WORKER_POOL_OPTIONS = {
  workerFactory: () =>
    new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
      type: "module",
    }),
  poolSize: 2,
};

const DIFF_HIGHLIGHTER_OPTIONS = {
  langs: ["text", "ts", "tsx", "js", "jsx", "json", "md", "css", "html", "bash", "python", "go", "rust"],
  theme: DEFAULT_THEMES,
  preferredHighlighter: "shiki-js" as const,
  lineDiffType: "none" as const,
  maxLineDiffLength: 1000,
  tokenizeMaxLineLength: 1000,
};

export function PierreDiffWorkerPoolProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<PierreDiffPreferenceState>(readStoredDiffPreferences);

  useEffect(() => {
    try {
      window.localStorage.setItem(DIFF_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Preferences are local-only UI state; rendering should continue if storage is unavailable.
    }
  }, [preferences]);

  const setDiffStyle = useCallback((diffStyle: PierreDiffStyle) => {
    setPreferences((current) => ({ ...current, diffStyle }));
  }, []);

  const setSimilarChanges = useCallback((enabled: boolean) => {
    setPreferences((current) => ({ ...current, lineDiffType: enabled ? "word-alt" : "none" }));
  }, []);

  const preferenceValue = useMemo<PierreDiffPreferences>(
    () => ({
      ...preferences,
      similarChanges: preferences.lineDiffType !== "none",
      setDiffStyle,
      setSimilarChanges,
    }),
    [preferences, setDiffStyle, setSimilarChanges],
  );

  return (
    <WorkerPoolContextProvider poolOptions={DIFF_WORKER_POOL_OPTIONS} highlighterOptions={DIFF_HIGHLIGHTER_OPTIONS}>
      <PierreDiffPreferencesContext.Provider value={preferenceValue}>
        {children}
      </PierreDiffPreferencesContext.Provider>
    </WorkerPoolContextProvider>
  );
}

export function usePierreDiffPreferences(): PierreDiffPreferences {
  return use(PierreDiffPreferencesContext) ?? {
    ...DEFAULT_DIFF_PREFERENCES,
    similarChanges: false,
    setDiffStyle: () => undefined,
    setSimilarChanges: () => undefined,
  };
}

function changedLineCount(patch?: string): number {
  if (!patch) return 0;
  let count = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) count += 1;
    if (line.startsWith("-") && !line.startsWith("---")) count += 1;
  }
  return count;
}

/**
 * Delay mounting heavy content until the browser is idle so large diffs render
 * automatically without blocking the first paint of the surrounding thread.
 */
function useIdleMount(defer: boolean): boolean {
  const [ready, setReady] = useState(!defer);

  useEffect(() => {
    if (!defer || ready) {
      return;
    }

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => setReady(true), { timeout: 500 });
      return () => window.cancelIdleCallback(handle);
    }

    const handle = window.setTimeout(() => setReady(true), 50);
    return () => window.clearTimeout(handle);
  }, [defer, ready]);

  return ready;
}

export function PierreDiffView({
  patch,
  fileName,
  oldContent,
  newContent,
  diffStyle = "unified",
  lineDiffType = "none",
}: {
  patch?: string;
  fileName?: string;
  oldContent?: string | null;
  newContent?: string;
  diffStyle?: PierreDiffStyle;
  lineDiffType?: PierreLineDiffType;
}) {
  const { resolvedTheme } = useTheme();
  const themeType: ThemeTypes = resolvedTheme === "light" ? "light" : "dark";
  const disableWorkerPool = lineDiffType !== "none";
  const changes = changedLineCount(patch);
  const requiresOptIn = changes > MAX_AUTO_RENDERED_CHANGED_LINES;
  const [optedIn, setOptedIn] = useState(false);
  const idleReady = useIdleMount(changes > DEFERRED_RENDER_CHANGED_LINES && !requiresOptIn);

  const diffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      theme: DEFAULT_THEMES,
      themeType,
      disableLineNumbers: false,
      overflow: "wrap",
      diffStyle,
      diffIndicators: "bars",
      lineHoverHighlight: "both",
      disableBackground: false,
      expansionLineCount: 20,
      hunkSeparators: "line-info-basic",
      lineDiffType,
      maxLineDiffLength: 1000,
      tokenizeMaxLineLength: 1000,
      disableFileHeader: true,
    }),
    [diffStyle, lineDiffType, themeType],
  );

  if (requiresOptIn && !optedIn) {
    return (
      <div className="border border-border/60 bg-muted/20 px-4 py-5 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Large diff</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          This change has {changes.toLocaleString()} changed lines. Rendering it may briefly slow this thread.
        </p>
        <button
          type="button"
          onClick={() => setOptedIn(true)}
          className="mt-3 inline-flex items-center rounded-sm border border-border bg-background px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-foreground transition-colors hover:bg-muted"
        >
          Show diff
        </button>
      </div>
    );
  }

  if (!requiresOptIn && !idleReady) {
    return (
      <div className="border border-border/60 bg-muted/20 px-4 py-5 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Preparing diff ({changes.toLocaleString()} changed lines)…
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
    contents: newContent ?? "",
  } satisfies FileContents;

  return (
    <Virtualizer
      className="pierre-diff-virtualizer minimal-scrollbar max-h-[min(65vh,620px)] min-h-0 overflow-auto overscroll-contain bg-background"
      contentClassName="min-w-0"
    >
      <div className="pierre-diff-view min-w-0">
        {patch ? (
          <PatchDiff patch={patch} options={diffOptions} disableWorkerPool={disableWorkerPool} />
        ) : (
          <MultiFileDiff oldFile={before} newFile={after} options={diffOptions} disableWorkerPool={disableWorkerPool} />
        )}
      </div>
    </Virtualizer>
  );
}
