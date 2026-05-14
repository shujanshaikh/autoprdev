import { cn } from "@autopr/ui/lib/utils";
import { Loader2, Monitor } from "lucide-react";
import { useEffect, useReducer, useRef } from "react";

type DaytonaDesktopViewProps = {
  websocketUrl?: string;
  loading?: boolean;
  className?: string;
};

type RfbInstance = {
  scaleViewport: boolean;
  resizeSession: boolean;
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

export function DaytonaDesktopView({ websocketUrl, loading = false, className }: DaytonaDesktopViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const [connection, updateConnection] = useReducer(
    (
      _state: { state: "idle" | "connecting" | "connected" | "disconnected" | "error"; error?: string },
      next: { state: "idle" | "connecting" | "connected" | "disconnected" | "error"; error?: string },
    ) => next,
    { state: "idle" },
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !websocketUrl) {
      return;
    }

    let disposed = false;
    const handleConnect: EventListener = () => {
      updateConnection({ state: "connected" });
      requestAnimationFrame(() => rfbRef.current?.focus());
    };
    const handleDisconnect: EventListener = (event) => {
      const detail = (event as CustomEvent<{ clean?: boolean }>).detail;
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

        const RFB = module.default as RfbConstructor;
        const rfb = new RFB(containerRef.current, websocketUrl, { shared: true });
        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfb.background = "#000000";

        rfb.addEventListener("connect", handleConnect);
        rfb.addEventListener("disconnect", handleDisconnect);
        rfb.addEventListener("securityfailure", handleSecurityFailure);
        rfb.addEventListener("credentialsrequired", handleCredentialsRequired);
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
      const rfb = rfbRef.current;
      rfb?.removeEventListener("connect", handleConnect);
      rfb?.removeEventListener("disconnect", handleDisconnect);
      rfb?.removeEventListener("securityfailure", handleSecurityFailure);
      rfb?.removeEventListener("credentialsrequired", handleCredentialsRequired);
      rfbRef.current = null;
      rfb?.disconnect();
      container.replaceChildren();
    };
  }, [websocketUrl]);

  const { state, error } = connection;
  const showOverlay = loading || !websocketUrl || state === "connecting" || state === "error";

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-zinc-950", className)}>
      <div
        ref={containerRef}
        role="application"
        aria-label="Remote desktop"
        className="h-full w-full [&_canvas]:outline-none"
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
