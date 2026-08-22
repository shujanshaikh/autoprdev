import { api } from "@autopr/backend/convex/_generated/api";
import { cn } from "@autopr/ui/lib/utils";
import { useAction } from "convex/react";
import { GripHorizontal, Monitor, RotateCw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { DaytonaDesktopView } from "./daytona-desktop-view";
import { DESKTOP_PREVIEW_HEARTBEAT_MS } from "./daytona-desktop-connection";

type PreviewPosition = { x: number; y: number };
type DesktopPreviewConnection = {
  projectId: string;
  websocketUrl: string;
  expiresAt: number;
};
type DesktopPreviewRequest = {
  projectId: string;
  promise: Promise<void>;
};

type ThreadComputerPreviewProps = {
  projectId: string;
  activityKey?: string;
  active: boolean;
};

const PREVIEW_EDGE_GAP = 12;
const KEYBOARD_MOVE_STEP = 16;
const PREVIEW_REFRESH_MARGIN_MS = 30_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function clampComputerPreviewPosition(
  position: PreviewPosition,
  boundary: Pick<DOMRect, "width" | "height">,
  preview: Pick<DOMRect, "width" | "height">,
): PreviewPosition {
  return {
    x: clamp(position.x, PREVIEW_EDGE_GAP, boundary.width - preview.width - PREVIEW_EDGE_GAP),
    y: clamp(position.y, PREVIEW_EDGE_GAP, boundary.height - preview.height - PREVIEW_EDGE_GAP),
  };
}

export function ThreadComputerPreview({
  projectId,
  activityKey,
  active,
}: ThreadComputerPreviewProps) {
  const [dismissedActivityKey, setDismissedActivityKey] = useState<string>();
  const [position, setPosition] = useState<PreviewPosition>();
  const [connection, setConnection] = useState<DesktopPreviewConnection>();
  const [loadingProjectId, setLoadingProjectId] = useState<string>();
  const [previewError, setPreviewError] = useState<{ projectId: string; message: string }>();
  const previewRef = useRef<HTMLElement | null>(null);
  const loadingRequestRef = useRef<DesktopPreviewRequest | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const getDesktopPreview = useAction(api.projectActions.getDesktopPreview);
  const refreshDesktopActivity = useAction(api.projectActions.refreshDesktopActivity);

  const open = Boolean(activityKey && dismissedActivityKey !== activityKey);
  const currentConnection = connection?.projectId === projectId ? connection : undefined;
  const websocketUrl = currentConnection?.websocketUrl;
  const loading = loadingProjectId === projectId;
  const error = previewError?.projectId === projectId ? previewError.message : undefined;

  const constrainPosition = useCallback((nextPosition: PreviewPosition) => {
    const preview = previewRef.current;
    const boundary = preview?.parentElement;
    if (!preview || !boundary) {
      return nextPosition;
    }

    return clampComputerPreviewPosition(
      nextPosition,
      boundary.getBoundingClientRect(),
      preview.getBoundingClientRect(),
    );
  }, []);

  const loadDesktop = useCallback((force = false) => {
    if (
      !force
      && currentConnection
      && Date.now() < currentConnection.expiresAt - PREVIEW_REFRESH_MARGIN_MS
    ) {
      return Promise.resolve();
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
    const pending = getDesktopPreview({ projectId })
      .then((preview) => {
        if (loadingRequestRef.current?.promise !== pending) {
          return;
        }
        setConnection({
          projectId,
          websocketUrl: preview.websocketUrl,
          expiresAt: Date.now() + preview.expiresInSeconds * 1_000,
        });
      })
      .catch((cause: unknown) => {
        if (loadingRequestRef.current?.promise === pending) {
          if (connectionAtRequest && Date.now() < connectionAtRequest.expiresAt) {
            return;
          }
          setConnection((current) => current?.projectId === projectId ? undefined : current);
          setPreviewError({
            projectId,
            message: cause instanceof Error ? cause.message : "Could not open the desktop preview.",
          });
        }
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

  useEffect(() => {
    if (!open || error) {
      return;
    }

    void loadDesktop();
    const heartbeat = window.setInterval(() => {
      void refreshDesktopActivity({ projectId }).catch(() => undefined);
    }, DESKTOP_PREVIEW_HEARTBEAT_MS);

    return () => window.clearInterval(heartbeat);
  }, [error, loadDesktop, open, projectId, refreshDesktopActivity]);

  useEffect(() => {
    const preview = previewRef.current;
    const boundary = preview?.parentElement;
    if (!preview || !boundary || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      setPosition((current) => current ? constrainPosition(current) : current);
    });
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [constrainPosition, open]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const closePreview = useCallback(() => {
    if (activityKey) {
      setDismissedActivityKey(activityKey);
    }
  }, [activityKey]);

  const movePreview = useCallback((deltaX: number, deltaY: number) => {
    const preview = previewRef.current;
    const boundary = preview?.parentElement;
    if (!preview || !boundary) return;

    const previewRect = preview.getBoundingClientRect();
    const boundaryRect = boundary.getBoundingClientRect();
    const current = position ?? {
      x: previewRect.left - boundaryRect.left,
      y: previewRect.top - boundaryRect.top,
    };
    setPosition(constrainPosition({ x: current.x + deltaX, y: current.y + deltaY }));
  }, [constrainPosition, position]);

  const handleMoveKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const deltas: Partial<Record<string, [number, number]>> = {
      ArrowDown: [0, KEYBOARD_MOVE_STEP],
      ArrowLeft: [-KEYBOARD_MOVE_STEP, 0],
      ArrowRight: [KEYBOARD_MOVE_STEP, 0],
      ArrowUp: [0, -KEYBOARD_MOVE_STEP],
    };
    const delta = deltas[event.key];
    if (!delta) return;

    event.preventDefault();
    movePreview(...delta);
  }, [movePreview]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const preview = previewRef.current;
    const boundary = preview?.parentElement;
    if (!preview || !boundary) return;

    event.preventDefault();
    dragCleanupRef.current?.();

    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const previewRect = preview.getBoundingClientRect();
    const boundaryRect = boundary.getBoundingClientRect();
    const startPointer = { x: event.clientX, y: event.clientY };
    const startPosition = {
      x: previewRect.left - boundaryRect.left,
      y: previewRect.top - boundaryRect.top,
    };
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let dragging = true;

    target.setPointerCapture(pointerId);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setPosition(constrainPosition({
        x: startPosition.x + moveEvent.clientX - startPointer.x,
        y: startPosition.y + moveEvent.clientY - startPointer.y,
      }));
    };

    const stopDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      dragCleanupRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    dragCleanupRef.current = stopDrag;
  }, [constrainPosition]);

  if (!open) {
    return null;
  }

  const positionStyle: CSSProperties = position
    ? { left: position.x, top: position.y }
    : { right: PREVIEW_EDGE_GAP, top: PREVIEW_EDGE_GAP };

  return (
    <aside
      ref={previewRef}
      aria-label="Live computer preview"
      className="absolute z-30 w-[calc(100%-1.5rem)] max-w-[360px] overflow-hidden border border-border/80 bg-background text-foreground shadow-md"
      style={positionStyle}
    >
      <header className="flex h-8 items-center border-b border-border/70 bg-muted/50">
        <button
          type="button"
          aria-label="Move desktop preview"
          title="Drag to move. Arrow keys also move the preview."
          className="flex h-full min-w-0 flex-1 touch-none cursor-grab items-center gap-2 px-2.5 text-left active:cursor-grabbing focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          onKeyDown={handleMoveKeyDown}
          onPointerDown={startDrag}
        >
          <GripHorizontal className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          <span
            className={cn(
              "size-1.5 shrink-0 bg-muted-foreground/50",
              active && "bg-[color:var(--cohere-deep-green)]",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {active ? "Computer active" : "Desktop preview"}
          </span>
        </button>
        <button
          type="button"
          aria-label="Close desktop preview"
          onClick={closePreview}
          className="flex size-8 shrink-0 items-center justify-center border-l border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </header>

      <div className="relative aspect-video bg-black">
        {error && !websocketUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background px-5 text-center">
            <Monitor className="size-4 text-muted-foreground" aria-hidden="true" />
            <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => void loadDesktop(true)}
              className="inline-flex h-7 items-center gap-1.5 border border-border bg-background px-2.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <RotateCw className="size-3" aria-hidden="true" />
              Retry
            </button>
          </div>
        ) : (
          <DaytonaDesktopView
            websocketUrl={websocketUrl}
            loading={loading && !websocketUrl}
            interactive={false}
            className="absolute inset-0"
            onReconnectRequired={() => void loadDesktop(true)}
          />
        )}
      </div>
    </aside>
  );
}
