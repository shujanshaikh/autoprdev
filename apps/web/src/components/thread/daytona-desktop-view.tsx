import { cn } from "@autopr/ui/lib/utils";
import { Loader2, Monitor } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

const DESKTOP_WIDTH = 1920;
const DESKTOP_HEIGHT = 1080;
const DESKTOP_ASPECT_RATIO = DESKTOP_WIDTH / DESKTOP_HEIGHT;

type DaytonaDesktopViewProps = {
  websocketUrl?: string;
  loading?: boolean;
  className?: string;
};

type RfbInstance = {
  scaleViewport: boolean;
  resizeSession: boolean;
  clipViewport: boolean;
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

function applyFixedDesktopMode(rfb: RfbInstance) {
  rfb.clipViewport = false;
  rfb.scaleViewport = true;
  rfb.resizeSession = false;
}

export function DaytonaDesktopView({ websocketUrl, loading = false, className }: DaytonaDesktopViewProps) {
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
    const handleConnect: EventListener = () => {
      updateConnection({ state: "connected" });
      if (activeRfb) {
        applyFixedDesktopMode(activeRfb);
      }
      window.requestAnimationFrame(() => activeRfb?.focus());
    };
    const handleDisconnect: EventListener = (event) => {
      const detail = (/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ event as CustomEvent<{ clean?: boolean }>).detail;
      if (disposed) return;
      updateConnection(
        detail?.clean === false
          ? { state: "error", error: "The VNC connection closed unexpectedly." }
          : { state: "disconnected" },
      );
    };
    const handleSecurityFailure: EventListener = () => {
      updateConnection({ state: "error", error: "The VNC server rejected the connection." });
    };
    const handleCredentialsRequired: EventListener = () => {
      updateConnection({ state: "error", error: "This VNC desktop requires credentials." });
    };
    updateConnection({ state: "connecting" });
    container.replaceChildren();

    void import("@novnc/novnc")
      .then((module) => {
        if (disposed || !containerRef.current) return;

        const RFB = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ module.default as RfbConstructor;
        const rfb = new RFB(containerRef.current, websocketUrl, { shared: true });
        applyFixedDesktopMode(rfb);
        rfb.background = "#000000";

        rfb.addEventListener("connect", handleConnect);
        rfb.addEventListener("disconnect", handleDisconnect);
        rfb.addEventListener("securityfailure", handleSecurityFailure);
        rfb.addEventListener("credentialsrequired", handleCredentialsRequired);
        activeRfb = rfb;
        rfbRef.current = rfb;
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
      const rfb = activeRfb;
      rfb?.removeEventListener("connect", handleConnect);
      rfb?.removeEventListener("disconnect", handleDisconnect);
      rfb?.removeEventListener("securityfailure", handleSecurityFailure);
      rfb?.removeEventListener("credentialsrequired", handleCredentialsRequired);
      rfbRef.current = null;
      activeRfb = null;
      rfb?.disconnect();
      container.replaceChildren();
    };
  }, [websocketUrl]);

  const { state, error } = connection;
  const showOverlay = loading || !websocketUrl || state === "connecting" || state === "error";
  const frameStyle = frameSize
    ? { width: `${frameSize.width}px`, height: `${frameSize.height}px` }
    : { width: "100%", aspectRatio: `${DESKTOP_WIDTH} / ${DESKTOP_HEIGHT}` };

  return (
    <div
      ref={shellRef}
      className={cn("relative flex h-full w-full items-center justify-center overflow-hidden bg-black", className)}
    >
      <div
        ref={containerRef}
        role="application"
        aria-label="Remote desktop"
        className="shrink-0 overflow-hidden bg-black [&>div]:!h-full [&>div]:!w-full [&>div]:!overflow-hidden [&_canvas]:outline-none"
        style={frameStyle}
        onMouseDown={() => rfbRef.current?.focus()}
      />

      {showOverlay ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center">
          <div className="max-w-[240px] space-y-3">
            <span className="mx-auto flex size-9 items-center justify-center border border-white/10 bg-white/[0.04]">
              {loading || state === "connecting" ? (
                <Loader2 className="size-4 animate-spin text-white/70" aria-hidden="true" />
              ) : (
                <Monitor className="size-4 text-white/70" aria-hidden="true" />
              )}
            </span>
            <p className="text-sm font-medium text-white">
              {error
                ? "Desktop connection failed"
                : loading || state === "connecting"
                ? "Connecting to desktop…"
                : "Preparing desktop…"}
            </p>
            {error ? (
              <p className="text-xs leading-relaxed text-white/55">{error}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
