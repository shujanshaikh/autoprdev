import { api } from "@autopr/backend/convex/_generated/api";
import { useAction } from "convex/react";
import { Eraser, Loader2, Plus, RotateCw, TerminalSquare, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import type { ITheme, Terminal as XtermTerminal } from "@xterm/xterm";

import "@xterm/xterm/css/xterm.css";

type TerminalConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

type DaytonaTerminalViewProps = {
  projectId: string;
  threadId: string;
  label: string;
  active: boolean;
  onNewTerminal: () => void;
  onClose: () => void;
  onSessionChange?: (sessionId: string | undefined) => void;
};

function normalizeComputedColor(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized
    || normalized === "transparent"
    || normalized === "rgba(0, 0, 0, 0)"
    || normalized === "rgba(0 0 0 / 0)"
  ) {
    return fallback;
  }
  return value ?? fallback;
}

function terminalThemeFromApp(surface?: HTMLElement | null): ITheme {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const cssColor = (name: string, fallback: string) =>
    normalizeComputedColor(styles.getPropertyValue(name), fallback);
  const dark = root.classList.contains("dark");
  const fallbackBackground = dark ? "#1d1c22" : "#f4f1f7";
  const background = normalizeComputedColor(
    surface ? getComputedStyle(surface).backgroundColor : undefined,
    fallbackBackground,
  );

  return {
    background,
    foreground: cssColor("--framer-ink", dark ? "#f7f5f8" : "#211e26"),
    cursor: cssColor("--framer-accent-blue", dark ? "#b7a4ff" : "#5b3fd1"),
    cursorAccent: background,
    selectionBackground: dark ? "rgba(183, 164, 255, 0.24)" : "rgba(91, 63, 209, 0.18)",
    scrollbarSliderBackground: dark ? "rgba(247, 245, 248, 0.10)" : "rgba(33, 30, 38, 0.12)",
    scrollbarSliderHoverBackground: dark ? "rgba(247, 245, 248, 0.18)" : "rgba(33, 30, 38, 0.20)",
    scrollbarSliderActiveBackground: dark ? "rgba(247, 245, 248, 0.24)" : "rgba(33, 30, 38, 0.26)",
    black: dark ? "#323038" : "#4b4650",
    brightBlack: dark ? "#77717d" : "#817987",
    red: cssColor("--framer-gradient-coral", dark ? "#f5796c" : "#c94948"),
    brightRed: dark ? "#ff9a90" : "#df6257",
    green: cssColor("--framer-success", dark ? "#58c99b" : "#288963"),
    brightGreen: dark ? "#7ee0b8" : "#35a477",
    yellow: cssColor("--framer-gradient-orange", dark ? "#f2a15f" : "#b66a2e"),
    brightYellow: dark ? "#ffc083" : "#d48342",
    blue: cssColor("--framer-accent-blue", dark ? "#b7a4ff" : "#5b3fd1"),
    brightBlue: dark ? "#cfc3ff" : "#7964df",
    magenta: cssColor("--framer-gradient-magenta", dark ? "#e77aae" : "#b3487a"),
    brightMagenta: dark ? "#f49bc7" : "#c9578b",
    cyan: dark ? "#70c7d2" : "#2f7f8c",
    brightCyan: dark ? "#9be0e6" : "#4597a4",
    white: dark ? "#d8d3dc" : "#d8d2dc",
    brightWhite: dark ? "#ffffff" : "#f8f6f9",
  };
}

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

function terminalLocation(cwd: string | undefined) {
  if (!cwd) return "workspace";
  return cwd.replace(/^\/home\//, "~/");
}

export function DaytonaTerminalView({
  projectId,
  threadId,
  label,
  active,
  onNewTerminal,
  onClose,
  onSessionChange,
}: DaytonaTerminalViewProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<XtermFitAddon | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const connectionIdRef = useRef(0);
  const activeRef = useRef(active);
  const onSessionChangeRef = useRef(onSessionChange);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [status, setStatus] = useState<TerminalConnectionStatus>("connecting");
  const [error, setError] = useState<string | undefined>();
  const [cwd, setCwd] = useState<string | undefined>();
  const getPtyTerminal = useAction(api.projectActions.getPtyTerminal);
  const resizePtyTerminal = useAction(api.projectActions.resizePtyTerminal);
  const killPtyTerminal = useAction(api.projectActions.killPtyTerminal);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    onSessionChangeRef.current = onSessionChange;
  }, [onSessionChange]);

  const connect = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    const isActiveConnection = () => connectionIdRef.current === connectionId;

    setStatus("connecting");
    setError(undefined);
    container.innerHTML = "";
    websocketRef.current?.close();
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;

    try {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      const styles = getComputedStyle(document.documentElement);
      const terminal = new Terminal({
        allowProposedApi: false,
        cursorBlink: true,
        cursorStyle: "block",
        cursorWidth: 2,
        convertEol: true,
        fontFamily: styles.getPropertyValue("--font-mono").trim() || '"SFMono-Regular", Menlo, Consolas, monospace',
        fontSize: 13,
        fontWeight: 500,
        fontWeightBold: 700,
        letterSpacing: 0.15,
        lineHeight: 1.34,
        scrollback: 5000,
        smoothScrollDuration: 100,
        theme: terminalThemeFromApp(surfaceRef.current),
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      fitAddon.fit();

      if (!isActiveConnection()) {
        terminal.dispose();
        return;
      }

      const terminalInfo = await getPtyTerminal({
        projectId,
        threadId,
        cols: terminal.cols || 100,
        rows: terminal.rows || 30,
      });
      if (!isActiveConnection()) {
        terminal.dispose();
        await killPtyTerminal({ projectId, sessionId: terminalInfo.sessionId }).catch(() => undefined);
        return;
      }

      sessionIdRef.current = terminalInfo.sessionId;
      onSessionChangeRef.current?.(terminalInfo.sessionId);
      setCwd(terminalInfo.cwd);
      terminal.reset();

      const socket = new WebSocket(terminalInfo.websocketUrl, "X-Daytona-SDK-Version~");
      socket.binaryType = "arraybuffer";
      websocketRef.current = socket;
      const isActiveSocket = () => isActiveConnection() && websocketRef.current === socket;
      let receivedOutput = false;
      let resizeTimer: number | undefined;
      let wakeTimer: number | undefined;
      let inputDisposed = false;

      const send = (data: string) => {
        if (isActiveSocket() && socket.readyState === WebSocket.OPEN) {
          socket.send(new TextEncoder().encode(data));
        }
      };
      const inputDisposable = terminal.onData(send);
      terminal.attachCustomKeyEventHandler((event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && event.type === "keydown") {
          event.preventDefault();
          terminal.clear();
          send("\u000c");
          return false;
        }
        return true;
      });
      const disposeInput = () => {
        if (inputDisposed) return;
        inputDisposed = true;
        inputDisposable.dispose();
      };

      socket.addEventListener("open", () => {
        if (!isActiveSocket()) return;
        if (activeRef.current) terminal.focus();
        setStatus("connected");
        setError(undefined);
        wakeTimer = window.setTimeout(() => {
          if (!receivedOutput && socket.readyState === WebSocket.OPEN) {
            send("\r");
          }
        }, 250);
      });

      socket.addEventListener("message", async (event) => {
        if (!isActiveSocket()) return;
        const text = await decodeTerminalData(event.data);
        if (!isActiveSocket()) return;
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
        websocketRef.current = null;
        setStatus("disconnected");
        setError("Terminal disconnected. Reconnect to continue.");
      });
      socket.addEventListener("error", () => {
        if (!isActiveSocket()) return;
        window.clearTimeout(wakeTimer);
        setStatus("error");
        setError("Terminal connection failed.");
      });

      const resizeObserver = new ResizeObserver(() => {
        if (!isActiveSocket() || !activeRef.current || container.clientWidth === 0 || container.clientHeight === 0) {
          return;
        }
        fitAddon.fit();
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          void resizePtyTerminal({
            projectId,
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }, 120);
      });
      resizeObserver.observe(container);

      const themeObserver = new MutationObserver(() => {
        if (!isActiveConnection()) return;
        terminal.options.theme = terminalThemeFromApp(surfaceRef.current);
        terminal.refresh(0, terminal.rows - 1);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });

      return () => {
        if (connectionIdRef.current === connectionId) {
          connectionIdRef.current += 1;
        }
        window.clearTimeout(wakeTimer);
        window.clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        themeObserver.disconnect();
        disposeInput();
        if (websocketRef.current === socket) websocketRef.current = null;
        if (terminalRef.current === terminal) terminalRef.current = null;
        if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
        socket.close();
        terminal.dispose();
      };
    } catch (cause) {
      if (!isActiveConnection()) return;
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not start terminal.");
    }
  }, [getPtyTerminal, killPtyTerminal, projectId, resizePtyTerminal, threadId]);

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
  }, [connect, connectionAttempt]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      const sessionId = sessionIdRef.current;
      if (!container || !terminal || !fitAddon || container.clientWidth === 0 || container.clientHeight === 0) {
        return;
      }
      fitAddon.fit();
      terminal.focus();
      if (sessionId) {
        void resizePtyTerminal({
          projectId,
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, projectId, resizePtyTerminal]);

  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear();
    const socket = websocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(new TextEncoder().encode("\u000c"));
    }
    terminalRef.current?.focus();
  }, []);

  const reconnectTerminal = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = undefined;
    onSessionChangeRef.current?.(undefined);
    if (sessionId) {
      await killPtyTerminal({ projectId, sessionId }).catch(() => undefined);
    }
    setConnectionAttempt((attempt) => attempt + 1);
  }, [killPtyTerminal, projectId]);

  const statusLabel = status === "connected"
    ? "connected"
    : status === "connecting"
      ? "connecting"
      : "offline";

  return (
    <div
      ref={surfaceRef}
      className="autopr-terminal relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--autopr-terminal-bg)]"
    >
      <div className="autopr-terminal-toolbar flex h-9 shrink-0 items-center gap-3 border-b border-[color:var(--autopr-terminal-line)] px-3">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" aria-hidden="true" />
          <span className="size-2.5 rounded-full bg-[#28c840]" aria-hidden="true" />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[10.5px]">
          <TerminalSquare className="size-3.5 shrink-0 text-[color:var(--autopr-terminal-muted)]" aria-hidden="true" />
          <span className="truncate font-medium text-[color:var(--autopr-terminal-fg)]">{label}</span>
          <span className="truncate text-[color:var(--autopr-terminal-muted)]">{terminalLocation(cwd)}</span>
        </div>

        <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--autopr-terminal-muted)] min-[520px]:inline-flex">
          {status === "connecting" ? (
            <Loader2 className="size-2.5 animate-spin" aria-hidden="true" />
          ) : (
            <span
              className={status === "connected" ? "size-1.5 rounded-full bg-[#28c840]" : "size-1.5 rounded-full bg-[color:var(--framer-gradient-coral)]"}
              aria-hidden="true"
            />
          )}
          {statusLabel}
        </span>

        <div className="flex shrink-0 items-center gap-0.5 rounded-[8px] border border-[color:var(--autopr-terminal-line)] bg-[color:var(--autopr-terminal-controls)] p-0.5">
          <button
            type="button"
            onClick={clearTerminal}
            className="autopr-terminal-action"
            aria-label="Clear terminal"
            title="Clear terminal (⌘/Ctrl K)"
          >
            <Eraser className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => void reconnectTerminal()}
            className="autopr-terminal-action"
            aria-label="Reconnect terminal"
            title="Reconnect terminal"
          >
            <RotateCw className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onNewTerminal}
            className="autopr-terminal-action"
            aria-label="New terminal tab"
            title="New terminal tab"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="autopr-terminal-action hover:text-[color:var(--framer-gradient-coral)]"
            aria-label={`Close ${label}`}
            title="Close terminal"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/25 bg-destructive/[0.055] px-3 py-1.5 font-mono text-[10px] text-destructive" role="alert">
          <span className="truncate">{error}</span>
          <button
            type="button"
            onClick={() => void reconnectTerminal()}
            className="shrink-0 text-foreground underline decoration-border underline-offset-2"
          >
            Reconnect
          </button>
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="min-h-0 flex-1 bg-[var(--autopr-terminal-bg)] [&_.xterm-helper-textarea]:opacity-0 [&_.xterm-helper-textarea]:focus-visible:outline-none"
      />
    </div>
  );
}
