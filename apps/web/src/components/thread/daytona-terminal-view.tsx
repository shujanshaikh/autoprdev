import { api } from "@autopr/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import "@xterm/xterm/css/xterm.css";

const TERMINAL_BACKGROUND = "#111111";

const TERMINAL_THEME = {
  background: TERMINAL_BACKGROUND,
  foreground: "#E2E2E2",
  cursor: "#C4B5FD",
  cursorAccent: TERMINAL_BACKGROUND,
  selectionBackground: "#2B2B2B",
  black: "#111111",
  brightBlack: "#666666",
  red: "#FF7B7B",
  brightRed: "#FFA6A6",
  green: "#8FD19E",
  brightGreen: "#B7E4C3",
  yellow: "#D6B35F",
  brightYellow: "#E6C978",
  blue: "#9DB8FF",
  brightBlue: "#C2D0FF",
  magenta: "#C4B5FD",
  brightMagenta: "#DDD6FE",
  cyan: "#8BD3DD",
  brightCyan: "#B8E4EA",
  white: "#D8D8D8",
  brightWhite: "#FFFFFF",
} as const;

type DaytonaTerminalViewProps = {
  projectId: string;
};

function decodeTerminalData(data: MessageEvent["data"]): Promise<string> {
  if (typeof data === "string") {
    try {
      const message = JSON.parse(data);
      if (message?.type === "control") return Promise.resolve("");
    } catch {
      // Not a control message.
    }
    return Promise.resolve(data);
  }

  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(data));
  if (ArrayBuffer.isView(data)) return Promise.resolve(new TextDecoder().decode(data));
  return Promise.resolve("");
}

export function DaytonaTerminalView({ projectId }: DaytonaTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const connectionIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const getPtyTerminal = useAction(api.projectActions.getPtyTerminal);
  const resizePtyTerminal = useAction(api.projectActions.resizePtyTerminal);

  const connect = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    const isActiveConnection = () => connectionIdRef.current === connectionId;

    setLoading(true);
    setError(undefined);
    container.innerHTML = "";
    websocketRef.current?.close();

    try {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      const styles = getComputedStyle(document.documentElement);
      const cssVar = (name: string) => styles.getPropertyValue(name).trim();
      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        convertEol: true,
        fontFamily: cssVar("--font-mono") || '"SFMono-Regular", Menlo, Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.28,
        scrollback: 3000,
        theme: TERMINAL_THEME,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      fitAddon.fit();

      if (!isActiveConnection()) {
        terminal.dispose();
        return;
      }
      const terminalInfo = await getPtyTerminal({ projectId, cols: terminal.cols || 100, rows: terminal.rows || 30 });
      const terminalInfoConnectionActive = isActiveConnection();
      if (!terminalInfoConnectionActive) {
        terminal.dispose();
        return;
      }

      sessionIdRef.current = terminalInfo.sessionId;
      terminal.reset();

      const socket = new WebSocket(terminalInfo.websocketUrl, "X-Daytona-SDK-Version~");
      socket.binaryType = "arraybuffer";
      websocketRef.current = socket;
      const isActiveSocket = () => isActiveConnection() && websocketRef.current === socket;
      let receivedOutput = false;
      let resizeTimer: number | undefined;
      let wakeTimer: number | undefined;
      let inputDisposed = false;

      const inputDisposable = terminal.onData((data) => {
        if (isActiveSocket() && socket.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
      });
      const disposeInput = () => {
        if (inputDisposed) return;
        inputDisposed = true;
        inputDisposable.dispose();
      };

      socket.addEventListener("open", () => {
        if (!isActiveSocket()) return;
        terminal.focus();
        setLoading(false);
        setError(undefined);
        wakeTimer = window.setTimeout(() => {
          if (!receivedOutput && socket.readyState === WebSocket.OPEN) {
            socket.send(new TextEncoder().encode("\r"));
          }
        }, 250);
      });

      socket.addEventListener("message", async (event) => {
        if (!isActiveSocket()) return;
        const text = await decodeTerminalData(event.data);
        const socketStillActive = isActiveSocket();
        if (!socketStillActive) return;
        if (text) {
          receivedOutput = true;
          window.clearTimeout(wakeTimer);
          setError(undefined);
          terminal.write(text);
        }
      });

      socket.addEventListener("close", () => {
        if (!isActiveSocket()) return;
        window.clearTimeout(wakeTimer);
        disposeInput();
        if (websocketRef.current === socket) {
          websocketRef.current = null;
        }
      });
      socket.addEventListener("error", () => {
        if (!isActiveSocket()) return;
        window.clearTimeout(wakeTimer);
        if (!receivedOutput) {
          setError("Terminal connection failed.");
        }
        setLoading(false);
      });

      const resizeObserver = new ResizeObserver(() => {
        if (!isActiveSocket()) return;
        fitAddon.fit();
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          void resizePtyTerminal({ projectId, sessionId, cols: terminal.cols, rows: terminal.rows });
        }, 150);
      });
      resizeObserver.observe(container);

      return () => {
        if (connectionIdRef.current === connectionId) {
          connectionIdRef.current += 1;
        }
        window.clearTimeout(wakeTimer);
        window.clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        disposeInput();
        if (websocketRef.current === socket) {
          websocketRef.current = null;
        }
        socket.close();
        terminal.dispose();
      };
    } catch (err) {
      if (!isActiveConnection()) return;
      setError(err instanceof Error ? err.message : "Could not start terminal.");
      setLoading(false);
    }
  }, [getPtyTerminal, projectId, resizePtyTerminal]);

  useEffect(() => {
    const container = containerRef.current;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void connect().then((value) => {
      if (disposed) {
        value?.();
        return;
      }
      cleanup = value;
    });

    return () => {
      disposed = true;
      cleanup?.();
      if (container) container.innerHTML = "";
    };
  }, [connect]);

  return (
    <div className="autopr-terminal relative flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--autopr-terminal-bg)]">
      <div
        ref={containerRef}
        className="min-h-0 flex-1 bg-[var(--autopr-terminal-bg)] [&_.xterm-helper-textarea]:opacity-0 [&_.xterm-helper-textarea]:focus-visible:outline-none [&_.xterm-viewport::-webkit-scrollbar-thumb]:bg-white/20 [&_.xterm-viewport::-webkit-scrollbar-track]:bg-transparent [&_.xterm-viewport::-webkit-scrollbar]:w-1.5"
      />
      {loading ? (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center border border-border/40 bg-background/90 px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
          <Loader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
          connecting
        </div>
      ) : null}
      {error ? (
        <div className="absolute left-2 right-2 top-2 border border-destructive/30 bg-background px-2 py-1.5 font-mono text-xs text-destructive" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
