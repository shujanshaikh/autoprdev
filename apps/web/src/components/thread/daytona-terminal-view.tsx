import { api } from "@autopr/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { useCallback, useEffect, useState } from "react";

type DaytonaTerminalViewProps = {
  projectId: string;
  active: boolean;
};

export function DaytonaTerminalView({ projectId, active }: DaytonaTerminalViewProps) {
  const getTerminalPreview = useAction(api.projectActions.getTerminalPreview);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);

  const connect = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      const preview = await getTerminalPreview({ projectId });
      setPreviewUrl(preview.url);
    } catch (cause) {
      setPreviewUrl(undefined);
      setError(cause instanceof Error ? cause.message : "Could not open the terminal.");
      setLoading(false);
    }
  }, [getTerminalPreview, projectId]);

  useEffect(() => {
    if (!active) return;
    void connect();
  }, [active, connect, connectionAttempt]);

  return (
    <div className="autopr-terminal relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--autopr-terminal-bg)]">
      {error ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/25 bg-destructive/[0.055] px-3 py-1.5 font-mono text-[10px] text-destructive" role="alert">
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={() => setConnectionAttempt((attempt) => attempt + 1)}
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
          onError={() => {
            setError("Terminal connection failed.");
            setLoading(false);
          }}
          onLoad={() => setLoading(false)}
          referrerPolicy="no-referrer"
          sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-scripts"
          src={previewUrl}
          title="Workspace terminal"
        />
      ) : null}
    </div>
  );
}
