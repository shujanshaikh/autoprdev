import type { DaytonaSandbox, SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand } from "../sandbox/execute";

const DEFAULT_CUA_SERVER_PORT = 8_765;
const DEFAULT_CUA_REQUEST_TIMEOUT_MS = 30_000;
const CUA_SERVER_READY_TIMEOUT_MS = 45_000;
const CUA_SERVER_READY_POLL_MS = 500;
const CUA_PREVIEW_URL_TTL_SECONDS = 10 * 60;
const CUA_PREVIEW_URL_REFRESH_MARGIN_MS = 30_000;
const CUA_CURSOR_RECOVERY_COOLDOWN_MS = 60_000;
const CUA_COMPUTER_SERVER_VERSION = "0.3.42";
const CUA_AGENT_CURSOR_THEME = "dev.autopr.cursor.neon";
const CUA_AGENT_CURSOR_REDUCED_MOTION = "off" as const;
const CUA_AGENT_CURSOR_MOTION = {
  start_handle: 0.3,
  end_handle: 0.3,
  arc_size: 0.3,
  arc_flow: 0.12,
  spring: 0.62,
  glide_duration_ms: 480,
  dwell_after_click_ms: 260,
  idle_hide_ms: 0,
  turn_radius: 80,
} as const;

const REQUIRED_CUA_COMMANDS = [
  "version",
  "open",
  "get_current_window_id",
  "get_window_name",
  "get_window_size",
  "get_window_position",
  "move_cursor",
  "left_click",
  "right_click",
  "mouse_down",
  "mouse_up",
  "double_click",
  "drag",
  "scroll_direction",
  "type_text",
  "press_key",
  "hotkey",
  "screenshot",
  "get_cursor_position",
  "get_screen_size",
] as const;

const CUA_AGENT_CURSOR_COMMANDS = [
  "set_agent_cursor_enabled",
  "set_agent_cursor_motion",
  "set_agent_cursor_theme",
  "get_agent_cursor_state",
  "probe_agent_cursor",
] as const;

const cuaServerStartPromises = new Map<string, Promise<void>>();
const cuaCursorRecoveryAttemptedAt = new Map<string, number>();
const cuaCursorRecoveryPromises = new Map<string, Promise<void>>();

export interface CuaComputerOptions {
  display?: string;
  serverPort?: number;
  requestTimeoutMs?: number;
}

export type CuaServerStatus = {
  status: "ok";
  os_type?: string;
  features?: unknown[];
  backend?: "cua-driver" | "native";
  cursor?: CuaAgentCursorStatus;
};

export type CuaAgentCursorStatus = {
  available: boolean;
  enabled: boolean;
  session?: string;
  theme?: string;
  reducedMotion?: "auto" | "on" | "off";
  motion?: CuaAgentCursorMotion;
  visualState?: Record<string, unknown>;
  runtimeMode?: "daemon" | "embedded";
  renderReady?: boolean;
  captureReady?: boolean;
  capture?: Record<string, unknown>;
  overlay?: Record<string, unknown>;
  capabilities: string[];
  reason?: string;
  error?: string;
  recoveryAttempted?: boolean;
};

export type CuaAgentCursorMotion = {
  start_handle: number;
  end_handle: number;
  arc_size: number;
  arc_flow: number;
  spring: number;
  glide_duration_ms: number;
  dwell_after_click_ms: number;
  idle_hide_ms: number;
  turn_radius: number;
};

export type CuaCommandResponse = Record<string, unknown> & {
  success: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cursorMotion(value: unknown): CuaAgentCursorMotion | undefined {
  if (!isRecord(value)) return undefined;
  const fields = Object.keys(CUA_AGENT_CURSOR_MOTION) as Array<keyof CuaAgentCursorMotion>;
  if (!fields.every((field) => typeof value[field] === "number")) return undefined;
  return Object.fromEntries(fields.map((field) => [field, value[field]])) as CuaAgentCursorMotion;
}

function usesRecordingCursorMotion(motion: CuaAgentCursorMotion | undefined): boolean {
  return motion !== undefined && Object.entries(CUA_AGENT_CURSOR_MOTION).every(
    ([field, expected]) => Math.abs(motion[field as keyof CuaAgentCursorMotion] - expected) < 0.001,
  );
}

function validateServerPort(port: number): number {
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`Invalid CUA computer-server port: ${port}`);
  }
  return port;
}

function validateRequestTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error(`Invalid CUA request timeout: ${timeoutMs}`);
  }
  return Math.ceil(timeoutMs);
}

function appendUrlPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  return url.toString();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`CUA computer-server request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parseCuaCommandResponse(body: string): CuaCommandResponse {
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(6));
    } catch (error) {
      throw new Error(`CUA computer-server returned invalid JSON: ${errorMessage(error)}`);
    }

    if (!isRecord(parsed)) {
      throw new Error("CUA computer-server returned a non-object command result.");
    }
    if (parsed.success !== true) {
      const detail = typeof parsed.error === "string" ? parsed.error : "unknown CUA command failure";
      throw new Error(`CUA computer-server command failed: ${detail}`);
    }

    return parsed as CuaCommandResponse;
  }

  throw new Error("CUA computer-server returned no SSE data frame.");
}

export function cuaBootstrapCommand(): string {
  return [
    "set -eu",
    'IMAGE_LAUNCHER="/opt/autopr/bin/autopr-cua-computer-server"',
    'if [ -x "$IMAGE_LAUNCHER" ]; then exec "$IMAGE_LAUNCHER"; fi',
    'if command -v autopr-cua-computer-server >/dev/null 2>&1; then exec autopr-cua-computer-server; fi',
    `CUA_VERSION=${CUA_COMPUTER_SERVER_VERSION}`,
    'CUA_RUNTIME="/home/daytona/.local/share/autopr/cua-${CUA_VERSION}"',
    'if [ ! -x "$CUA_RUNTIME/bin/cua-computer-server" ]; then',
    '  PYTHON_BIN="$(command -v python3 || true)"',
    '  if [ -n "$PYTHON_BIN" ] && "$PYTHON_BIN" -c \'import sys; assert (3, 12) <= sys.version_info < (3, 14)\' 2>/dev/null; then',
    '    "$PYTHON_BIN" -m venv --clear "$CUA_RUNTIME"',
    '    "$CUA_RUNTIME/bin/pip" install --disable-pip-version-check --no-cache-dir "cua-computer-server==${CUA_VERSION}"',
    '  elif command -v uv >/dev/null 2>&1; then',
    '    CUA_PYTHON_DIR="/home/daytona/.local/share/autopr/python"',
    '    UV_PYTHON_INSTALL_DIR="$CUA_PYTHON_DIR" uv python install 3.13',
    '    UV_PYTHON_INSTALL_DIR="$CUA_PYTHON_DIR" uv venv --clear "$CUA_RUNTIME" --python 3.13',
    '    uv pip install --python "$CUA_RUNTIME/bin/python" --no-cache "cua-computer-server==${CUA_VERSION}"',
    '  else',
    '    echo "CUA needs Python 3.12/3.13 or uv to provision it" >&2',
    '    exit 127',
    '  fi',
    "fi",
    'SERVER="$CUA_RUNTIME/bin/cua-computer-server"',
    'mkdir -p /tmp/autopr-cua "$XDG_RUNTIME_DIR"',
    'chmod 700 "$XDG_RUNTIME_DIR"',
    'cua_command() { curl --fail --silent --max-time 10 -H "Content-Type: application/json" --data "$1" "http://127.0.0.1:${CUA_PORT}/cmd" | sed -n \'s/^data: //p\'; }',
    'VERSION_RESPONSE="$(cua_command \'{"command":"version"}\' || true)"',
    'SCREEN_RESPONSE="$(cua_command \'{"command":"get_screen_size"}\' || true)"',
    "if curl --fail --silent --max-time 2 \"http://127.0.0.1:${CUA_PORT}/status\" | jq -e '.status == \"ok\" and .os_type == \"linux\"' >/dev/null 2>&1 \\",
    "  && printf \"%s\" \"$VERSION_RESPONSE\" | jq -e --arg expected \"$CUA_VERSION\" '.success == true and .package == $expected' >/dev/null 2>&1 \\",
    "  && printf \"%s\" \"$SCREEN_RESPONSE\" | jq -e '.success == true and (.size.width | type == \"number\") and (.size.height | type == \"number\")' >/dev/null 2>&1; then exit 0; fi",
    'if [ -s /tmp/autopr-cua/computer-server.pid ]; then',
    '  OLD_PID="$(cat /tmp/autopr-cua/computer-server.pid)"',
    '  if kill -0 "$OLD_PID" 2>/dev/null && [ -r "/proc/${OLD_PID}/cmdline" ] && tr "\\0" " " <"/proc/${OLD_PID}/cmdline" | grep -Fq "$SERVER"; then kill "$OLD_PID" 2>/dev/null || true; sleep 1; fi',
    "fi",
    'if lsof -nP -iTCP:"$CUA_PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "CUA port is already occupied" >&2; exit 1; fi',
    'unset CONTAINER_NAME UNAVAILABLE_WITHOUT_CONTAINER_NAME NO_AT_BRIDGE',
    'export BROWSER="${BROWSER:-google-chrome}"',
    'nohup "$SERVER" --host 0.0.0.0 --port "$CUA_PORT" --backend native --log-level warning >/tmp/autopr-cua/computer-server.log 2>&1 &',
    'echo "$!" >/tmp/autopr-cua/computer-server.pid',
  ].join("\n");
}

async function startCuaServer(
  sandbox: DaytonaSandbox,
  sandboxOptions: SandboxSessionOptions,
  options: Required<Pick<CuaComputerOptions, "display" | "serverPort">>,
): Promise<void> {
  const startKey = `${sandbox.id}:${options.serverPort}:${options.display}`;
  const existing = cuaServerStartPromises.get(startKey);
  if (existing) return await existing;

  const pending = (async () => {
    const result = await executeSandboxCommand(cuaBootstrapCommand(), {
      cwd: "/home/daytona",
      timeout: 7 * 60,
      env: {
        CUA_PORT: String(options.serverPort),
        DISPLAY: options.display,
        XDG_RUNTIME_DIR: "/tmp/autopr-cua-runtime",
      },
      sandboxOptions: {
        ...sandboxOptions,
        cacheKey: sandbox.id,
        sandboxId: sandbox.id,
      },
    });

    if (result.timedOut || result.exitCode !== 0) {
      const diagnostic = result.stderr || result.stdout || result.output || "unknown startup failure";
      throw new Error(`Could not start CUA computer-server in Daytona: ${diagnostic}`);
    }
  })();

  cuaServerStartPromises.set(startKey, pending);
  try {
    await pending;
  } finally {
    if (cuaServerStartPromises.get(startKey) === pending) {
      cuaServerStartPromises.delete(startKey);
    }
  }
}

export class CuaComputerClient {
  private baseUrl?: string;
  private baseUrlExpiresAt = 0;
  private baseUrlPromise?: Promise<string>;
  private readonly display: string;
  private readonly serverPort: number;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly sandbox: DaytonaSandbox,
    private readonly sandboxOptions: SandboxSessionOptions,
    options: CuaComputerOptions = {},
  ) {
    this.display = options.display ?? process.env.DAYTONA_DISPLAY ?? ":1";
    this.serverPort = validateServerPort(options.serverPort ?? DEFAULT_CUA_SERVER_PORT);
    this.requestTimeoutMs = validateRequestTimeout(
      options.requestTimeoutMs ?? DEFAULT_CUA_REQUEST_TIMEOUT_MS,
    );
  }

  private async url(path: string): Promise<string> {
    if (
      !this.baseUrl
      || Date.now() >= this.baseUrlExpiresAt - CUA_PREVIEW_URL_REFRESH_MARGIN_MS
    ) {
      if (!this.baseUrlPromise) {
        const pending = this.sandbox.getSignedPreviewUrl(
          this.serverPort,
          CUA_PREVIEW_URL_TTL_SECONDS,
        ).then((preview) => {
          this.baseUrl = preview.url;
          this.baseUrlExpiresAt = Date.now() + CUA_PREVIEW_URL_TTL_SECONDS * 1_000;
          return preview.url;
        });
        this.baseUrlPromise = pending;
        void pending.finally(() => {
          if (this.baseUrlPromise === pending) this.baseUrlPromise = undefined;
        }).catch(() => undefined);
      }
      await this.baseUrlPromise;
    }
    return appendUrlPath(this.baseUrl!, path);
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await fetchWithTimeout(
      await this.url(path),
      { headers: { Accept: "application/json" } },
      this.requestTimeoutMs,
    );
    if (!response.ok) {
      throw new Error(`CUA computer-server ${path} failed with HTTP ${response.status}.`);
    }
    return await response.json();
  }

  async status(): Promise<CuaServerStatus> {
    const payload = await this.getJson("/status");
    if (!isRecord(payload) || payload.status !== "ok") {
      throw new Error("CUA computer-server status response was invalid.");
    }
    return payload as CuaServerStatus;
  }

  async command(command: string, params?: Record<string, unknown>): Promise<CuaCommandResponse> {
    const response = await fetchWithTimeout(
      await this.url("/cmd"),
      {
        method: "POST",
        headers: {
          Accept: "text/plain",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params && Object.keys(params).length > 0
          ? { command, params }
          : { command }),
      },
      this.requestTimeoutMs,
    );
    if (!response.ok) {
      throw new Error(`CUA computer-server command ${command} failed with HTTP ${response.status}.`);
    }
    const result = parseCuaCommandResponse(await response.text());
    if (result.effect === "refused") {
      const detail = typeof result.text === "string"
        ? result.text
        : `CUA reported action effect ${result.effect}`;
      throw new Error(`CUA command ${command} was refused: ${detail}`);
    }
    return result;
  }

  private cursorStatus(
    backend: "cua-driver" | "native",
    commandManifest: Record<string, unknown>,
    state?: CuaCommandResponse,
  ): CuaAgentCursorStatus {
    const capabilities = CUA_AGENT_CURSOR_COMMANDS.filter(
      (command) => command in commandManifest,
    );
    if (backend === "native") {
      return {
        available: false,
        enabled: false,
        capabilities,
        reason: "CUA Driver is unavailable; native computer use and Daytona recording remain active.",
      };
    }
    if (capabilities.length !== CUA_AGENT_CURSOR_COMMANDS.length) {
      const missing = CUA_AGENT_CURSOR_COMMANDS.filter(
        (command) => !(command in commandManifest),
      );
      return {
        available: false,
        enabled: false,
        capabilities,
        reason: `CUA Driver does not expose the required agent cursor commands: ${missing.join(", ")}.`,
      };
    }

    const themeState = isRecord(state?.theme) ? state.theme : undefined;
    const theme = typeof themeState?.id === "string" ? themeState.id : undefined;
    const reducedMotion = ["auto", "on", "off"].includes(String(themeState?.reduced_motion))
      ? themeState?.reduced_motion as "auto" | "on" | "off"
      : undefined;
    const runtimeMode = ["daemon", "embedded"].includes(String(state?.runtime_mode))
      ? state?.runtime_mode as "daemon" | "embedded"
      : undefined;
    return {
      available: true,
      enabled: state?.enabled === true,
      session: typeof state?.session === "string" ? state.session : undefined,
      theme,
      reducedMotion,
      motion: cursorMotion(state?.motion),
      visualState: isRecord(state?.visual_state) ? state.visual_state : undefined,
      runtimeMode,
      renderReady: state?.render_ready === true,
      captureReady: state?.capture_ready === true,
      capture: isRecord(state?.capture) ? state.capture : undefined,
      overlay: isRecord(state?.overlay) ? state.overlay : undefined,
      capabilities,
    };
  }

  async inspect(): Promise<CuaServerStatus> {
    const [status, commands, version, screen] = await Promise.all([
      this.status(),
      this.getJson("/commands"),
      this.command("version"),
      this.command("get_screen_size"),
    ]);

    if (status.os_type && status.os_type !== "linux") {
      throw new Error(`Expected CUA computer-server on Linux, received ${status.os_type}.`);
    }
    const commandManifest = isRecord(commands) ? commands.commands : undefined;
    if (!isRecord(commandManifest)) {
      throw new Error("CUA computer-server command manifest was invalid.");
    }
    const missing = REQUIRED_CUA_COMMANDS.filter((command) => !(command in commandManifest));
    if (missing.length > 0) {
      throw new Error(`CUA computer-server is missing required commands: ${missing.join(", ")}.`);
    }
    if (version.package !== CUA_COMPUTER_SERVER_VERSION) {
      const received = typeof version.package === "string" ? version.package : "unknown";
      throw new Error(
        `Expected CUA computer-server ${CUA_COMPUTER_SERVER_VERSION}, received ${received}.`,
      );
    }
    const size = isRecord(screen.size) ? screen.size : undefined;
    if (typeof size?.width !== "number" || typeof size.height !== "number") {
      throw new Error("CUA computer-server could not read the Daytona desktop size.");
    }
    const backend = "get_desktop_state" in commandManifest ? "cua-driver" : "native";
    let cursor = this.cursorStatus(backend, commandManifest);
    if (cursor.available) {
      try {
        cursor = this.cursorStatus(
          backend,
          commandManifest,
          await this.command("get_agent_cursor_state"),
        );
      } catch (error) {
        cursor = {
          ...cursor,
          error: errorMessage(error),
        };
      }
    }
    return {
      ...status,
      backend,
      cursor,
    };
  }

  private async initializeAgentCursor(status: CuaServerStatus): Promise<CuaServerStatus> {
    const cursor = status.cursor;
    if (status.backend !== "cua-driver" || !cursor?.available) return status;
    if (
      cursor.enabled
      && cursor.theme === CUA_AGENT_CURSOR_THEME
      && cursor.reducedMotion === CUA_AGENT_CURSOR_REDUCED_MOTION
      && usesRecordingCursorMotion(cursor.motion)
      && cursor.runtimeMode === "daemon"
      && cursor.renderReady
      && cursor.captureReady
      && !cursor.error
    ) return status;

    try {
      if (
        cursor.theme !== CUA_AGENT_CURSOR_THEME
        || cursor.reducedMotion !== CUA_AGENT_CURSOR_REDUCED_MOTION
      ) {
        await this.command("set_agent_cursor_theme", {
          theme_id: CUA_AGENT_CURSOR_THEME,
          reduced_motion: CUA_AGENT_CURSOR_REDUCED_MOTION,
        });
      }
      if (!usesRecordingCursorMotion(cursor.motion)) {
        await this.command("set_agent_cursor_motion", CUA_AGENT_CURSOR_MOTION);
      }
      if (!cursor.enabled) {
        await this.command("set_agent_cursor_enabled", { enabled: true });
      }
      // This is deliberately stronger than trusting `enabled`: CUA 0.19.3's
      // embedded Linux runtime can accept that setter without owning an X11
      // overlay thread. The compatibility probe moves only the official
      // overlay, then verifies that its mapped window has a painted shape.
      const state = await this.command("probe_agent_cursor");
      const initializedCursor: CuaAgentCursorStatus = {
        ...cursor,
        enabled: state.enabled === true,
        session: typeof state.session === "string" ? state.session : cursor.session,
        theme: isRecord(state.theme) && typeof state.theme.id === "string"
          ? state.theme.id
          : cursor.theme,
        reducedMotion: isRecord(state.theme)
          && ["auto", "on", "off"].includes(String(state.theme.reduced_motion))
          ? state.theme.reduced_motion as "auto" | "on" | "off"
          : cursor.reducedMotion,
        motion: cursorMotion(state.motion) ?? cursor.motion,
        visualState: isRecord(state.visual_state) ? state.visual_state : cursor.visualState,
        runtimeMode: ["daemon", "embedded"].includes(String(state.runtime_mode))
          ? state.runtime_mode as "daemon" | "embedded"
          : cursor.runtimeMode,
        renderReady: state.render_ready === true,
        captureReady: state.capture_ready === true,
        capture: isRecord(state.capture) ? state.capture : cursor.capture,
        overlay: isRecord(state.overlay) ? state.overlay : cursor.overlay,
        error: undefined,
      };
      if (!initializedCursor.enabled) {
        initializedCursor.error = "CUA Driver accepted cursor initialization but still reports it disabled.";
      } else if (initializedCursor.theme !== CUA_AGENT_CURSOR_THEME) {
        initializedCursor.enabled = false;
        initializedCursor.error = `CUA Driver did not activate the requested cursor theme ${CUA_AGENT_CURSOR_THEME}.`;
      } else if (initializedCursor.reducedMotion !== CUA_AGENT_CURSOR_REDUCED_MOTION) {
        initializedCursor.enabled = false;
        initializedCursor.error = "CUA Driver did not enable full cursor animation.";
      } else if (!usesRecordingCursorMotion(initializedCursor.motion)) {
        initializedCursor.enabled = false;
        initializedCursor.error = "CUA Driver did not activate the recording cursor motion profile.";
      } else if (initializedCursor.runtimeMode !== "daemon") {
        initializedCursor.enabled = false;
        initializedCursor.error = "CUA Driver is not running in its overlay-owning daemon mode.";
      } else if (!initializedCursor.renderReady) {
        initializedCursor.enabled = false;
        initializedCursor.error = initializedCursor.captureReady
          ? "CUA Driver did not paint a visible X11 agent-cursor overlay."
          : "CUA Driver's overlay was not present in a captured X11 desktop frame.";
      }
      return { ...status, cursor: initializedCursor };
    } catch (error) {
      return {
        ...status,
        cursor: {
          ...cursor,
          enabled: false,
          error: `Could not initialize the CUA agent cursor: ${errorMessage(error)}`,
        },
      };
    }
  }

  async ensureReady(): Promise<CuaServerStatus> {
    let initialStatus: CuaServerStatus | undefined;
    try {
      initialStatus = await this.initializeAgentCursor(await this.inspect());
      if (
        initialStatus.backend === "cua-driver"
        && initialStatus.cursor?.enabled
        && initialStatus.cursor.renderReady
        && initialStatus.cursor.captureReady
        && !initialStatus.cursor.error
      ) {
        return initialStatus;
      }
    } catch {
      // The server is installed in the AutoPR snapshot and started lazily. The
      // fallback bootstrap keeps existing sandboxes usable until that snapshot
      // has been rebuilt and rolled out.
    }

    const recoveryKey = `${this.sandbox.id}:${this.serverPort}:${this.display}`;
    const lastRecovery = cuaCursorRecoveryAttemptedAt.get(recoveryKey) ?? 0;
    let recovery = cuaCursorRecoveryPromises.get(recoveryKey);
    let recoveryAttempted = recovery !== undefined;
    if (!recovery && Date.now() - lastRecovery >= CUA_CURSOR_RECOVERY_COOLDOWN_MS) {
      recoveryAttempted = true;
      const attemptedAt = Date.now();
      cuaCursorRecoveryAttemptedAt.set(recoveryKey, attemptedAt);
      const cleanup = setTimeout(() => {
        if (cuaCursorRecoveryAttemptedAt.get(recoveryKey) === attemptedAt) {
          cuaCursorRecoveryAttemptedAt.delete(recoveryKey);
        }
      }, CUA_CURSOR_RECOVERY_COOLDOWN_MS);
      cleanup.unref?.();
      const pending = startCuaServer(this.sandbox, this.sandboxOptions, {
        display: this.display,
        serverPort: this.serverPort,
      });
      cuaCursorRecoveryPromises.set(recoveryKey, pending);
      void pending.finally(() => {
        if (cuaCursorRecoveryPromises.get(recoveryKey) === pending) {
          cuaCursorRecoveryPromises.delete(recoveryKey);
        }
      }).catch(() => undefined);
      recovery = pending;
    }

    if (recovery) {
      try {
        // A healthy native server is still degraded on Driver-capable images.
        // Running the image launcher lets it replace a stale native fallback,
        // restart a Driver whose overlay thread died, and then re-probe the
        // exact session before the next action (especially start_recording).
        await recovery;
      } catch (error) {
        if (initialStatus) {
          return {
            ...initialStatus,
            cursor: initialStatus.cursor
              ? {
                  ...initialStatus.cursor,
                  recoveryAttempted: true,
                  error: initialStatus.cursor.error
                    ? `${initialStatus.cursor.error} Recovery failed: ${errorMessage(error)}`
                    : `CUA Driver cursor recovery failed: ${errorMessage(error)}`,
                }
              : initialStatus.cursor,
          };
        }
        throw error;
      }
    } else if (initialStatus) {
      return initialStatus;
    }

    const deadline = Date.now() + CUA_SERVER_READY_TIMEOUT_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const recovered = await this.initializeAgentCursor(await this.inspect());
        return {
          ...recovered,
          cursor: recovered.cursor
            ? { ...recovered.cursor, recoveryAttempted }
            : recovered.cursor,
        };
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, CUA_SERVER_READY_POLL_MS));
      }
    }

    throw new Error(
      `CUA computer-server did not become ready: ${errorMessage(lastError ?? "readiness timeout")}`,
    );
  }
}
