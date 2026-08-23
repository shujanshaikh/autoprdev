import { api } from "@autopr/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { Monitor, RotateCw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DaytonaDesktopView } from "./daytona-desktop-view";
import {
  DESKTOP_PREVIEW_REFRESH_MARGIN_MS,
  requestSharedDesktopPreview,
  subscribeDesktopActivity,
} from "./daytona-desktop-connection";

type DesktopPreviewConnection = {
  projectId: string;
  websocketUrl: string;
  expiresAt: number;
  revision: number;
};
type DesktopPreviewRequest = {
  projectId: string;
  promise: Promise<boolean>;
};

type ThreadComputerPreviewProps = {
  projectId: string;
  activityKey?: string;
};

export function ThreadComputerPreview({
  projectId,
  activityKey,
}: ThreadComputerPreviewProps) {
  const [dismissedActivityKey, setDismissedActivityKey] = useState<string>();
  const [connection, setConnection] = useState<DesktopPreviewConnection>();
  const [loadingProjectId, setLoadingProjectId] = useState<string>();
  const [previewError, setPreviewError] = useState<{ projectId: string; message: string }>();
  const loadingRequestRef = useRef<DesktopPreviewRequest | null>(null);
  const getDesktopPreview = useAction(api.projectActions.getDesktopPreview);
  const refreshDesktopActivity = useAction(api.projectActions.refreshDesktopActivity);

  const open = Boolean(activityKey && dismissedActivityKey !== activityKey);
  const currentConnection = connection?.projectId === projectId ? connection : undefined;
  const websocketUrl = currentConnection?.websocketUrl;
  const loading = loadingProjectId === projectId;
  const error = previewError?.projectId === projectId ? previewError.message : undefined;

  const loadDesktop = useCallback((force = false, preserveConnection = false) => {
    if (
      !force
      && currentConnection
      && Date.now() < currentConnection.expiresAt - DESKTOP_PREVIEW_REFRESH_MARGIN_MS
    ) {
      return Promise.resolve(true);
    }

    const existingRequest = loadingRequestRef.current;
    if (existingRequest?.projectId === projectId) {
      return existingRequest.promise;
    }

    if (!currentConnection) {
      setConnection((current) => current?.projectId === projectId ? undefined : current);
    }
    setLoadingProjectId(projectId);
    setPreviewError(undefined);
    const connectionAtRequest = currentConnection;
    const pending = requestSharedDesktopPreview(projectId, force, () =>
      getDesktopPreview(force ? { projectId, recoverStream: true } : { projectId }),
    )
      .then((preview) => {
        if (loadingRequestRef.current?.promise !== pending) {
          return false;
        }
        setConnection({
          projectId,
          websocketUrl: preview.websocketUrl,
          expiresAt: Date.now() + preview.expiresInSeconds * 1_000,
          revision: (connectionAtRequest?.revision ?? 0) + 1,
        });
        return true;
      })
      .catch((cause: unknown) => {
        if (loadingRequestRef.current?.promise === pending) {
          if (preserveConnection && connectionAtRequest) {
            // DaytonaDesktopView owns the backoff and will ask again. Keeping
            // even an expired route mounted keeps that recovery loop alive
            // until fresh credentials become available.
            return false;
          }
          if (connectionAtRequest && Date.now() < connectionAtRequest.expiresAt) {
            return false;
          }
          setConnection((current) => current?.projectId === projectId ? undefined : current);
          setPreviewError({
            projectId,
            message: cause instanceof Error ? cause.message : "Could not open the desktop preview.",
          });
        }
        return false;
      })
      .finally(() => {
        if (loadingRequestRef.current?.promise === pending) {
          loadingRequestRef.current = null;
          setLoadingProjectId(undefined);
        }
      });

    loadingRequestRef.current = { projectId, promise: pending };
    return pending;
  }, [currentConnection, getDesktopPreview, projectId]);

  const retryDesktop = useCallback(() => {
    void loadDesktop(true);
  }, [loadDesktop]);

  useEffect(() => {
    if (!open || error) {
      return;
    }

    void loadDesktop();
    return subscribeDesktopActivity(
      projectId,
      () => refreshDesktopActivity({ projectId }),
    );
  }, [error, loadDesktop, open, projectId, refreshDesktopActivity]);

  const closePreview = useCallback(() => {
    if (activityKey) {
      setDismissedActivityKey(activityKey);
    }
  }, [activityKey]);

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
            onReconnectRequired={(reason) => loadDesktop(reason === "stream", true)}
          />
        )}
      </div>
    </aside>
  );
}
