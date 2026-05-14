import { api } from "@autopr/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import "@xterm/xterm/css/xterm.css";

const TERMINAL_THEME = {
  background: "#111113",
  foreground: "#d7d7d8",
  cursor: "#d7d7d8",
  cursorAccent: "#111113",
  selectionBackground: "#34343a",
  black: "#111113",
  brightBlack: "#737373",
  red: "#ef4444",
  brightRed: "#f87171",
  green: "#22c55e",
  brightGreen: "#4ade80",
  yellow: "#eab308",
  brightYellow: "#facc15",
  blue: "#60a5fa",
  brightBlue: "#93c5fd",
  magenta: "#c084fc",
  brightMagenta: "#d8b4fe",
  cyan: "#22d3ee",
  brightCyan: "#67e8f9",
  white: "#d4d4d4",
  brightWhite: "#ffffff",
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
  const resizeTimerRef = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const getPtyTerminal = useAction(api.projectActions.getPtyTerminal);
  const resizePtyTerminal = useAction(api.projectActions.resizePtyTerminal);

  const connect = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

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
        lineHeight: 1.25,
        scrollback: 3000,
        theme: TERMINAL_THEME,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      fitAddon.fit();

      const terminalInfo = await getPtyTerminal({ projectId, cols: terminal.cols || 100, rows: terminal.rows || 30 });
      sessionIdRef.current = terminalInfo.sessionId;
      terminal.reset();

      const socket = new WebSocket(terminalInfo.websocketUrl, "X-Daytona-SDK-Version~");
      socket.binaryType = "arraybuffer";
      websocketRef.current = socket;

      const inputDisposable = terminal.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
      });

      socket.addEventListener("open", () => {
        terminal.focus();
        setLoading(false);
      });

      socket.addEventListener("message", async (event) => {
        const text = await decodeTerminalData(event.data);
        if (text) terminal.write(text);
      });

      socket.addEventListener("close", () => inputDisposable.dispose());
      socket.addEventListener("error", () => {
        setError("Terminal connection failed.");
        setLoading(false);
      });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = window.setTimeout(() => {
          void resizePtyTerminal({ projectId, sessionId, cols: terminal.cols, rows: terminal.rows });
        }, 150);
      });
      resizeObserver.observe(container);

      return () => {
        resizeObserver.disconnect();
        inputDisposable.dispose();
        terminal.dispose();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start terminal.");
      setLoading(false);
    }
  }, [getPtyTerminal, projectId, resizePtyTerminal]);

  useEffect(() => {
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
      websocketRef.current?.close();
      websocketRef.current = null;
      window.clearTimeout(resizeTimerRef.current);
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [connect]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-card">
      <div
        ref={containerRef}
        className="h-full w-full p-2 [&_.xterm-helper-textarea]:opacity-0 [&_.xterm-helper-textarea]:focus-visible:outline-none [&_.xterm-screen]:bg-[#111113] [&_.xterm-viewport::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&_.xterm-viewport::-webkit-scrollbar-track]:bg-transparent [&_.xterm-viewport::-webkit-scrollbar]:w-1.5 [&_.xterm-viewport]:bg-[#111113] [&_.xterm]:h-full"
      />
      {loading ? (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center border border-border/40 bg-card/90 px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
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
