import { cn } from "@autopr/ui/lib/utils";
import { Monitor } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

const DESKTOP_WIDTH = 1920;
const DESKTOP_HEIGHT = 1080;
const DESKTOP_ASPECT_RATIO = DESKTOP_WIDTH / DESKTOP_HEIGHT;
const CONNECTION_RETRY_DELAY_MS = 300;
const CONNECTION_STABLE_MS = 10_000;
const MAX_CONNECTION_ATTEMPTS = 3;
const MAX_RECOVERY_DELAY_MS = 10_000;

type ConnectionState =
  | { state: "idle" }
  | { state: "connecting"; phase: "opening" | "reconnecting" }
  | { state: "connected" }
  | { state: "error"; error: string };

type DaytonaDesktopViewProps = {
  websocketUrl?: string;
  loading?: boolean;
  className?: string;
  interactive?: boolean;
  onReconnectRequired?: () => void;
};

type RfbInstance = {
  scaleViewport: boolean;
  resizeSession: boolean;
  clipViewport: boolean;
  // noVNC exposes this at runtime but omits it from its published TypeScript declaration.
  viewOnly?: boolean;
  background: string;
  focus: () => void;
  disconnect: () => void;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
};

type RfbConstructor = new (
  target: HTMLElement,
  url: string,
  options?: { shared?: boolean; credentials?: Record<string, string> },
) => RfbInstance;

function applyFixedDesktopMode(rfb: RfbInstance, interactive: boolean) {
  rfb.clipViewport = false;
  rfb.scaleViewport = true;
  rfb.resizeSession = false;
  rfb.viewOnly = !interactive;
}

export function DaytonaDesktopView({
  websocketUrl,
  loading = false,
  className,
  interactive = true,
  onReconnectRequired,
}: DaytonaDesktopViewProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const reconnectRequiredRef = useRef(onReconnectRequired);
  // react-doctor-disable-next-line react-doctor/no-initialize-state -- Frame size depends on measured DOM layout after mount.
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | undefined>();
  const [connection, updateConnection] = useReducer(
    (_state: ConnectionState, next: ConnectionState) => next,
    { state: "idle" } satisfies ConnectionState,
  );

  useEffect(() => {
    reconnectRequiredRef.current = onReconnectRequired;
  }, [onReconnectRequired]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const updateFrameSize = () => {
      const { width: availableWidth, height: availableHeight } = shell.getBoundingClientRect();
      if (availableWidth <= 0 || availableHeight <= 0) return;

      let width = availableWidth;
      let height = width / DESKTOP_ASPECT_RATIO;

      if (height > availableHeight) {
        height = availableHeight;
        width = height * DESKTOP_ASPECT_RATIO;
      }

      const next = {
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height)),
      };

      setFrameSize((current) => (
        current?.width === next.width && current.height === next.height ? current : next
      ));
    };

    // react-doctor-disable-next-line react-doctor/no-initialize-state -- Initial desktop sizing needs the mounted shell dimensions.
    updateFrameSize();

    const resizeObserver = new ResizeObserver(updateFrameSize);
    resizeObserver.observe(shell);
    window.addEventListener("resize", updateFrameSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateFrameSize);
    };
  }, []);

  // react-doctor-disable-next-line react-doctor/exhaustive-deps -- This effect owns the active RFB instance and clears the shared focus ref on teardown.
  useEffect(() => {
    if (!frameSize) return;
    const resizeEvent = new Event("resize");
    window.requestAnimationFrame(() => window.dispatchEvent(resizeEvent));
  }, [frameSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !websocketUrl) {
      return;
    }

    let disposed = false;
    let activeRfb: RfbInstance | null = null;
    let connectionAttempt = 0;
    let recoveryCycle = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stabilityTimer: ReturnType<typeof setTimeout> | undefined;
    updateConnection({ state: "connecting", phase: "opening" });
    container.replaceChildren();

    void import("@novnc/novnc")
      .then((module) => {
        if (disposed || !containerRef.current) return;

        const RFB = module.default as RfbConstructor;

        const connect = () => {
          if (disposed || !containerRef.current) return;

          connectionAttempt += 1;
          updateConnection({
            state: "connecting",
            phase: connectionAttempt === 1 && recoveryCycle === 0 ? "opening" : "reconnecting",
          });
          containerRef.current.replaceChildren();

          const rfb = new RFB(containerRef.current, websocketUrl, { shared: true });
          activeRfb = rfb;
          rfbRef.current = rfb;
          applyFixedDesktopMode(rfb, interactive);
          rfb.background = "#000000";

          const isCurrent = () => !disposed && activeRfb === rfb;
          const clearStabilityTimer = () => {
            if (stabilityTimer) clearTimeout(stabilityTimer);
            stabilityTimer = undefined;
          };
          const removeListeners = () => {
            rfb.removeEventListener("connect", handleConnect);
            rfb.removeEventListener("disconnect", handleDisconnect);
            rfb.removeEventListener("securityfailure", handleSecurityFailure);
            rfb.removeEventListener("credentialsrequired", handleCredentialsRequired);
          };
          const reconnect = () => {
            if (!isCurrent()) return;
            clearStabilityTimer();
            removeListeners();
            activeRfb = null;
            rfbRef.current = null;
            rfb.disconnect();

            let delay = CONNECTION_RETRY_DELAY_MS;
            if (connectionAttempt >= MAX_CONNECTION_ATTEMPTS) {
              connectionAttempt = 0;
              recoveryCycle += 1;
              reconnectRequiredRef.current?.();
              delay = Math.min(
                MAX_RECOVERY_DELAY_MS,
                1_000 * 2 ** Math.min(recoveryCycle - 1, 4),
              );
            }

            updateConnection({ state: "connecting", phase: "reconnecting" });
            retryTimer = setTimeout(connect, delay);
          };
          const fail = (error: string) => {
            if (!isCurrent()) return;
            clearStabilityTimer();
            removeListeners();
            activeRfb = null;
            rfbRef.current = null;
            rfb.disconnect();
            updateConnection({ state: "error", error });
          };
          const handleConnect: EventListener = () => {
            if (!isCurrent()) return;
            applyFixedDesktopMode(rfb, interactive);
            updateConnection({ state: "connected" });
            if (interactive) window.requestAnimationFrame(() => rfb.focus());

            // A connection that survives this window is healthy. Until then,
            // preserve the failure count so short-lived proxy connections can
            // still trigger a fresh signed Daytona URL.
            clearStabilityTimer();
            stabilityTimer = setTimeout(() => {
              if (!isCurrent()) return;
              connectionAttempt = 0;
              recoveryCycle = 0;
              stabilityTimer = undefined;
            }, CONNECTION_STABLE_MS);
          };
          const handleDisconnect: EventListener = () => {
            reconnect();
          };
          const handleSecurityFailure: EventListener = () => {
            fail("The VNC server rejected the connection.");
          };
          const handleCredentialsRequired: EventListener = () => {
            fail("This VNC desktop requires credentials.");
          };

          rfb.addEventListener("connect", handleConnect);
          rfb.addEventListener("disconnect", handleDisconnect);
          rfb.addEventListener("securityfailure", handleSecurityFailure);
          rfb.addEventListener("credentialsrequired", handleCredentialsRequired);
        };

        connect();
      })
      .catch((err) => {
        if (disposed) return;
        updateConnection({
          state: "error",
          error: err instanceof Error ? err.message : "Could not load the VNC client.",
        });
      });

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (stabilityTimer) clearTimeout(stabilityTimer);
      const rfb = activeRfb;
      rfbRef.current = null;
      activeRfb = null;
      rfb?.disconnect();
      container.replaceChildren();
    };
  }, [interactive, websocketUrl]);

  const showOverlay = loading || !websocketUrl || connection.state !== "connected";
  const loadingPresentation = connection.state === "error"
    ? {
        detail: connection.error,
        progress: "0%",
        title: "Desktop connection failed",
      }
    : !websocketUrl || loading || connection.state === "idle"
      ? {
          detail: "Starting the secure desktop session",
          progress: "25%",
          title: "Starting desktop",
        }
      : connection.state === "connecting" && connection.phase === "reconnecting"
        ? {
            detail: "The stream will resume automatically",
            progress: "42%",
            title: "Restoring desktop",
          }
        : {
            detail: "Opening the secure desktop stream",
            progress: "52%",
            title: "Connecting to desktop",
          };
  const frameStyle = frameSize
    ? { width: `${frameSize.width}px`, height: `${frameSize.height}px` }
    : { width: "100%", aspectRatio: `${DESKTOP_WIDTH} / ${DESKTOP_HEIGHT}` };

  return (
    <div
      ref={shellRef}
      className={cn("relative flex h-full w-full items-center justify-center overflow-hidden bg-background", className)}
    >
      <div
        ref={containerRef}
        role={interactive ? "application" : "img"}
        aria-label={interactive ? "Remote desktop" : "Live remote desktop preview"}
        className={cn(
          "shrink-0 overflow-hidden bg-black [&>div]:!h-full [&>div]:!w-full [&>div]:!overflow-hidden [&_canvas]:outline-none",
          !interactive && "pointer-events-none select-none",
        )}
        style={frameStyle}
        onMouseDown={interactive ? () => rfbRef.current?.focus() : undefined}
      />

      <div
        aria-hidden={!showOverlay}
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center bg-background px-6 text-center transition-opacity duration-200 ease-out motion-reduce:transition-none",
          showOverlay ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="w-full max-w-[260px]">
          <Monitor className="mx-auto size-4 text-muted-foreground" aria-hidden="true" />
          <div className="mx-auto mt-5 h-px w-24 overflow-hidden bg-border" aria-hidden="true">
            <div
              className="h-full bg-foreground/70 transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: loadingPresentation.progress }}
            />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground" role="status" aria-live="polite">
            {loadingPresentation.title}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {loadingPresentation.detail}
          </p>
        </div>
      </div>
    </div>
  );
}
