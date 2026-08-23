import { api } from "@autopr/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { Monitor, RotateCw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { DaytonaDesktopView } from "./daytona-desktop-view";
import {
  getDaytonaDesktopSession,
  subscribeDesktopActivity,
} from "./daytona-desktop-connection";

type ThreadComputerPreviewProps = {
  projectId: string;
  activityKey?: string;
};

export function ThreadComputerPreview({
  projectId,
  activityKey,
}: ThreadComputerPreviewProps) {
  const initialActivityKeyRef = useRef(activityKey);
  const [previewActivityKey, setPreviewActivityKey] = useState<string>();
  const [dismissedActivityKey, setDismissedActivityKey] = useState<string>();
  const getDesktopPreview = useAction(api.projectActions.getDesktopPreview);
  const refreshDesktopActivity = useAction(api.projectActions.refreshDesktopActivity);
  const desktopSession = useMemo(() => getDaytonaDesktopSession(projectId), [projectId]);
  const desktop = useSyncExternalStore(
    desktopSession.subscribe,
    desktopSession.getSnapshot,
    desktopSession.getServerSnapshot,
  );

  const open = Boolean(
    previewActivityKey
    && dismissedActivityKey !== previewActivityKey
  );
  const currentConnection = desktop.connection;
  const websocketUrl = currentConnection?.websocketUrl;
  const { loading, error } = desktop;

  const loadDesktop = useCallback((
    recoverStream = false,
    preserveConnection = false,
    failedRevision?: number,
  ) => desktopSession.request(
    () => getDesktopPreview(recoverStream ? { projectId, recoverStream: true } : { projectId }),
    { recoverStream, preserveConnection, failedRevision },
  ), [desktopSession, getDesktopPreview, projectId]);

  const retryDesktop = useCallback(() => {
    void loadDesktop(true);
  }, [loadDesktop]);

  useEffect(() => {
    if (activityKey && activityKey !== initialActivityKeyRef.current) {
      setPreviewActivityKey(activityKey);
    }
  }, [activityKey]);

  useEffect(() => {
    if (!open || error) {
      return;
    }

    void loadDesktop();
    return subscribeDesktopActivity(
      projectId,
      () => refreshDesktopActivity({ projectId }),
    );
  }, [currentConnection?.revision, error, loadDesktop, open, projectId, refreshDesktopActivity]);

  const closePreview = useCallback(() => {
    if (previewActivityKey) {
      setDismissedActivityKey(previewActivityKey);
    }
  }, [previewActivityKey]);

  if (!open) {
    return null;
  }

  return (
    <aside
      aria-label="Live computer preview"
      className="absolute right-3 top-3 z-30 w-[calc(100%-1.5rem)] max-w-[360px] overflow-hidden rounded-md border border-border/80 bg-black text-foreground shadow-md"
    >
      <div className="relative aspect-video bg-black">
        <button
          type="button"
          aria-label="Close desktop preview"
          onClick={closePreview}
          className="absolute right-1.5 top-1.5 z-10 flex size-7 items-center justify-center rounded-sm border border-white/15 bg-black/70 text-white/80 transition-colors hover:bg-black/90 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>

        {error && !websocketUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background px-5 text-center">
            <Monitor className="size-4 text-muted-foreground" aria-hidden="true" />
            <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={retryDesktop}
              className="inline-flex h-7 items-center gap-1.5 border border-border bg-background px-2.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <RotateCw className="size-3" aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : (
          <DaytonaDesktopView
            websocketUrl={websocketUrl}
            websocketUrlExpiresAt={currentConnection?.expiresAt}
            connectionRevision={currentConnection?.revision}
            loading={loading && !websocketUrl}
            interactive={false}
            className="absolute inset-0"
            onReconnectRequired={(reason, failedRevision) => (
              loadDesktop(reason === "stream", true, failedRevision)
            )}
          />
        )}
      </div>
    </aside>
  );
}
