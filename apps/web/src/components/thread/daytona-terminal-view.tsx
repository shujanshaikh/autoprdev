import { api } from "@autopr/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

type DaytonaTerminalViewProps = {
  projectId: string;
  threadId: string;
  active: boolean;
};

const TERMINAL_URL_REFRESH_SAFETY_SECONDS = 10;
const TERMINAL_OPEN_TIMEOUT_MS = 30_000;

export function DaytonaTerminalView({ projectId, threadId, active }: DaytonaTerminalViewProps) {
  const getTerminalPreview = useAction(api.projectActions.getTerminalPreview);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [previewExpiresAt, setPreviewExpiresAt] = useState<number>();
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearOpenTimeout = useCallback(() => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoading(true);
    setError(undefined);
    clearOpenTimeout();
    openTimeoutRef.current = setTimeout(() => {
      if (!current) return;
      current = false;
      openTimeoutRef.current = undefined;
      setPreviewUrl(undefined);
      setLoading(false);
      setError("The terminal took too long to open. Reconnect to try again.");
    }, TERMINAL_OPEN_TIMEOUT_MS);

    void getTerminalPreview({ projectId, threadId })
      .then((preview) => {
        if (!current) return;
        setPreviewUrl(preview.url);
        const refreshAfterSeconds = Math.max(
          1,
          preview.expiresInSeconds - TERMINAL_URL_REFRESH_SAFETY_SECONDS,
        );
        setPreviewExpiresAt(Date.now() + refreshAfterSeconds * 1_000);
      })
      .catch((cause) => {
        if (!current) return;
        clearOpenTimeout();
        setPreviewUrl(undefined);
        setError(cause instanceof Error ? cause.message : "Could not open the terminal.");
        setLoading(false);
      });

    return () => {
      current = false;
      clearOpenTimeout();
    };
  }, [active, clearOpenTimeout, connectionAttempt, getTerminalPreview, projectId, threadId]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    if (previewExpiresAt !== undefined) {
      refreshTimer = setTimeout(() => {
        setConnectionAttempt((attempt) => attempt + 1);
      }, Math.max(0, previewExpiresAt - Date.now()));
    }
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [previewExpiresAt]);

  return (
    <div className="autopr-terminal relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--autopr-terminal-bg)]">
      {error ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/25 bg-destructive/[0.055] px-3 py-1.5 font-mono text-[10px] text-destructive" role="alert">
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={() => {
              setPreviewExpiresAt(undefined);
              setConnectionAttempt((attempt) => attempt + 1);
            }}
            className="shrink-0 text-foreground underline decoration-border underline-offset-2"
          >
            Reconnect
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-[var(--autopr-terminal-bg)] font-mono text-[11px] text-muted-foreground">
          Opening secure terminal…
        </div>
      ) : null}

      {previewUrl ? (
        <iframe
          allow="clipboard-read; clipboard-write"
          className="min-h-0 flex-1 border-0 bg-[var(--autopr-terminal-bg)]"
          key={`${connectionAttempt}:${previewUrl}`}
          onError={() => {
            clearOpenTimeout();
            setError("Terminal connection failed.");
            setLoading(false);
          }}
          onLoad={() => {
            clearOpenTimeout();
            setLoading(false);
          }}
          referrerPolicy="no-referrer"
          sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts"
          src={previewUrl}
          title="Workspace terminal"
        />
      ) : null}
    </div>
  );
}
