import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
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
  const [websocketUrl, setWebsocketUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [previewExpiresAt, setPreviewExpiresAt] = useState<number>();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
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
      setWebsocketUrl(undefined);
      setLoading(false);
      setError("The terminal took too long to open. Reconnect to try again.");
    }, TERMINAL_OPEN_TIMEOUT_MS);

    void getTerminalPreview({ projectId, threadId })
      .then((preview) => {
        if (!current) return;
        setWebsocketUrl(preview.websocketUrl);
        const refreshAfterSeconds = Math.max(
          1,
          preview.expiresInSeconds - TERMINAL_URL_REFRESH_SAFETY_SECONDS,
        );
        setPreviewExpiresAt(Date.now() + refreshAfterSeconds * 1_000);
      })
      .catch((cause) => {
        if (!current) return;
        clearOpenTimeout();
        setWebsocketUrl(undefined);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !websocketUrl) return;

    let disposed = false;
    const encoder = new TextEncoder();
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      scrollback: 5_000,
      theme: {
        background: "#101010",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#3b3b3b",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const socket = new WebSocket(websocketUrl, ["tty"]);
    socket.binaryType = "arraybuffer";

    const sendCommand = (command: "0" | "1", payload: string) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encoder.encode(command + payload));
      }
    };

    const handleOpen = () => {
      if (disposed) return;
      socket.send(encoder.encode(JSON.stringify({
        AuthToken: "",
        columns: terminal.cols,
        rows: terminal.rows,
      })));
      clearOpenTimeout();
      setError(undefined);
      setLoading(false);
      fitAddon.fit();
      terminal.focus();
    };
    const handleMessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const message = new Uint8Array(event.data);
      if (message[0] === "0".charCodeAt(0)) {
        terminal.write(message.subarray(1));
      }
    };
    const handleError = () => {
      if (disposed) return;
      clearOpenTimeout();
      setError("Terminal connection failed. Reconnect to try again.");
      setLoading(false);
    };
    const handleClose = () => {
      if (disposed) return;
      clearOpenTimeout();
      setError("Terminal session ended. Reconnect to start a new session.");
      setLoading(false);
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);

    const inputSubscription = terminal.onData((data) => sendCommand("0", data));
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      sendCommand("1", JSON.stringify({ columns: cols, rows }));
    });
    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) fitAddon.fit();
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
      socket.close();
      inputSubscription.dispose();
      resizeSubscription.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      container.replaceChildren();
    };
  }, [clearOpenTimeout, websocketUrl]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

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

      <div
        ref={containerRef}
        aria-label="Workspace terminal"
        className="min-h-0 flex-1 overflow-hidden bg-[var(--autopr-terminal-bg)]"
        onMouseDown={() => terminalRef.current?.focus()}
        role="application"
      />
    </div>
  );
}
