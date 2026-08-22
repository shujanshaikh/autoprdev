import { cn } from "@autopr/ui/lib/utils";
import { Loader2, Monitor } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

const DESKTOP_WIDTH = 1920;
const DESKTOP_HEIGHT = 1080;
const DESKTOP_ASPECT_RATIO = DESKTOP_WIDTH / DESKTOP_HEIGHT;
const FRAME_PROBE_INTERVAL_MS = 250;
const FRAME_PROBE_TIMEOUT_MS = 4_000;
const CONNECTION_RETRY_DELAY_MS = 300;
const MAX_CONNECTION_ATTEMPTS = 3;

type DaytonaDesktopViewProps = {
  websocketUrl?: string;
  loading?: boolean;
  className?: string;
  interactive?: boolean;
};

type RfbInstance = {
  scaleViewport: boolean;
  resizeSession: boolean;
  clipViewport: boolean;
  // noVNC exposes this at runtime but omits it from its published TypeScript declaration.
  viewOnly?: boolean;
  background: string;
  getImageData: () => ImageData;
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

export function hasPaintedDesktopFrame(frame: Pick<ImageData, "data" | "height" | "width">) {
  if (frame.width <= 0 || frame.height <= 0 || frame.data.length < 4) return false;

  const sampleStride = Math.max(4, Math.floor(frame.data.length / (4 * 4_096)) * 4);
  let visibleSamples = 0;

  for (let index = 0; index < frame.data.length; index += sampleStride) {
    if (Math.max(frame.data[index] ?? 0, frame.data[index + 1] ?? 0, frame.data[index + 2] ?? 0) > 24) {
      visibleSamples += 1;
      if (visibleSamples >= 4) return true;
    }
  }

  return false;
}

export function DaytonaDesktopView({
  websocketUrl,
  loading = false,
  className,
  interactive = true,
}: DaytonaDesktopViewProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  // react-doctor-disable-next-line react-doctor/no-initialize-state -- Frame size depends on measured DOM layout after mount.
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | undefined>();
  const [connection, updateConnection] = useReducer(
    (
      _state: { state: "idle" | "connecting" | "connected" | "disconnected" | "error"; error?: string },
      next: { state: "idle" | "connecting" | "connected" | "disconnected" | "error"; error?: string },
    ) => next,
    { state: "idle" },
  );

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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    updateConnection({ state: "connecting" });
    container.replaceChildren();

    void import("@novnc/novnc")
      .then((module) => {
        if (disposed || !containerRef.current) return;

        const RFB = module.default as RfbConstructor;

        const connect = () => {
          if (disposed || !containerRef.current) return;

          connectionAttempt += 1;
          updateConnection({ state: "connecting" });
          containerRef.current.replaceChildren();

          const rfb = new RFB(containerRef.current, websocketUrl, { shared: true });
          activeRfb = rfb;
          rfbRef.current = rfb;
          applyFixedDesktopMode(rfb, interactive);
          rfb.background = "#000000";

          const isCurrent = () => !disposed && activeRfb === rfb;
          const clearProbe = () => {
            if (probeTimer) clearTimeout(probeTimer);
            probeTimer = undefined;
          };
          const removeListeners = () => {
            rfb.removeEventListener("connect", handleConnect);
            rfb.removeEventListener("disconnect", handleDisconnect);
            rfb.removeEventListener("securityfailure", handleSecurityFailure);
            rfb.removeEventListener("credentialsrequired", handleCredentialsRequired);
          };
          const retryOrFail = (error: string) => {
            if (!isCurrent()) return;
            clearProbe();
            removeListeners();
            activeRfb = null;
            rfbRef.current = null;
            rfb.disconnect();

            if (connectionAttempt >= MAX_CONNECTION_ATTEMPTS) {
              updateConnection({ state: "error", error });
              return;
            }

            retryTimer = setTimeout(connect, CONNECTION_RETRY_DELAY_MS);
          };
          const handleConnect: EventListener = () => {
            const deadline = Date.now() + FRAME_PROBE_TIMEOUT_MS;
            const probeFrame = () => {
              if (!isCurrent()) return;

              try {
                if (hasPaintedDesktopFrame(rfb.getImageData())) {
                  clearProbe();
                  updateConnection({ state: "connected" });
                  if (interactive) window.requestAnimationFrame(() => rfb.focus());
                  return;
                }
              } catch {
                // noVNC can expose its canvas just before the first resize lands.
              }

              if (Date.now() >= deadline) {
                retryOrFail("The desktop connected but did not produce a visible frame.");
                return;
              }
              probeTimer = setTimeout(probeFrame, FRAME_PROBE_INTERVAL_MS);
            };

            applyFixedDesktopMode(rfb, interactive);
            probeFrame();
          };
          const handleDisconnect: EventListener = () => {
            retryOrFail("The VNC connection closed before the desktop became ready.");
          };
          const handleSecurityFailure: EventListener = () => {
            if (!isCurrent()) return;
            clearProbe();
            updateConnection({ state: "error", error: "The VNC server rejected the connection." });
          };
          const handleCredentialsRequired: EventListener = () => {
            if (!isCurrent()) return;
            clearProbe();
            updateConnection({ state: "error", error: "This VNC desktop requires credentials." });
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
      if (probeTimer) clearTimeout(probeTimer);
      const rfb = activeRfb;
      rfbRef.current = null;
      activeRfb = null;
      rfb?.disconnect();
      container.replaceChildren();
    };
  }, [interactive, websocketUrl]);

  const { state, error } = connection;
  const showOverlay = loading || !websocketUrl || state === "connecting" || state === "error";
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

      {showOverlay ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background px-6 text-center">
          <div className="max-w-[240px] space-y-3">
            <span className="mx-auto flex size-9 items-center justify-center border border-border bg-muted/50">
              {loading || state === "connecting" ? (
                <Loader2 className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Monitor className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </span>
            <p className="text-sm font-medium text-foreground">
              {error
                ? "Desktop connection failed"
                : loading || state === "connecting"
                ? "Connecting to desktop…"
                : "Preparing desktop…"}
            </p>
            {error ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{error}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
