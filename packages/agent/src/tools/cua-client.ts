import type { DaytonaSandbox, SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand } from "../sandbox/execute";
import { sandboxUserHome } from "../sandbox/repo-path";

const DEFAULT_CUA_SERVER_PORT = 8_765;
// Two idempotent attempts fit inside the computer tool's 120-second boundary.
const DEFAULT_CUA_REQUEST_TIMEOUT_MS = 55_000;
const CUA_SERVER_READY_TIMEOUT_MS = 45_000;
const CUA_SERVER_READY_POLL_MS = 500;
const CUA_PREVIEW_URL_TTL_SECONDS = 10 * 60;
const CUA_PREVIEW_URL_REFRESH_MARGIN_MS = 30_000;
const CUA_CURSOR_RECOVERY_COOLDOWN_MS = 60_000;
const CUA_READY_CACHE_MS = 60_000;
const CUA_GATEWAY_PACKAGE = "autopr-cua-gateway";

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);
const REFRESHABLE_PREVIEW_HTTP_STATUSES = new Set([401, 403, 404]);
const IDEMPOTENT_CUA_COMMANDS = new Set([
  "version",
  "get_desktop_state",
  "get_capture_scope_state",
  "get_current_window_id",
  "get_application_windows",
  "get_window_name",
  "get_window_size",
  "get_window_position",
  "get_cursor_position",
  "get_screen_size",
  "get_agent_cursor_state",
  "copy_to_clipboard",
  "screenshot",
]);

const REQUIRED_CUA_COMMANDS = [
  "version",
  "open",
  "get_current_window_id",
  "get_application_windows",
  "get_window_name",
  "get_window_size",
  "get_window_position",
  "activate_window",
  "maximize_window",
  "move_cursor",
  "left_click",
  "middle_click",
  "right_click",
  "double_click",
  "drag",
  "scroll_direction",
  "type_text",
  "press_key",
  "hotkey",
  "screenshot",
  "get_cursor_position",
  "get_screen_size",
  "copy_to_clipboard",
  "set_clipboard",
] as const;

const CUA_AGENT_CURSOR_COMMANDS = [
  "get_agent_cursor_state",
  "set_agent_cursor_enabled",
] as const;
const REQUIRED_CUA_AGENT_CURSOR_COMMANDS = ["get_agent_cursor_state"] as const;

const cuaServerStartPromises = new Map<string, Promise<void>>();
const cuaCursorRecoveryAttemptedAt = new Map<string, number>();
const cuaCursorRecoveryPromises = new Map<string, Promise<void>>();
const desktopPointerSetupPromises = new WeakMap<object, Map<string, Promise<void>>>();

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
  implicit?: boolean;
  labelVisible?: boolean;
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
  const fields: Array<keyof CuaAgentCursorMotion> = [
    "start_handle",
    "end_handle",
    "arc_size",
    "arc_flow",
    "spring",
    "glide_duration_ms",
    "dwell_after_click_ms",
    "idle_hide_ms",
    "turn_radius",
  ];
  if (!fields.every((field) => typeof value[field] === "number")) return undefined;
  return Object.fromEntries(fields.map((field) => [field, value[field]])) as CuaAgentCursorMotion;
}

function validateServerPort(port: number): number {
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`Invalid CUA gateway port: ${port}`);
  }
  return port;
}

function validateRequestTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error(`Invalid CUA gateway request timeout: ${timeoutMs}`);
  }
  return Math.ceil(timeoutMs);
}

function appendUrlPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  return url.toString();
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ body: string; response: Response }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { body, response };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`CUA gateway request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parseCuaCommandResponse(body: string): CuaCommandResponse {
  const trimmed = body.trim();
  const dataFrame = body.split(/\r?\n/).find((line) => line.startsWith("data: "));
  const payload = trimmed.startsWith("{") ? trimmed : dataFrame?.slice(6);
  if (!payload) {
    throw new Error("CUA gateway returned no JSON command result.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new Error(`CUA gateway returned invalid JSON: ${errorMessage(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error("CUA gateway returned a non-object command result.");
  }
  if (parsed.success !== true) {
    const detail = typeof parsed.error === "string" ? parsed.error : "unknown CUA command failure";
    throw new Error(`CUA gateway command failed: ${detail}`);
  }
  return parsed as CuaCommandResponse;
}

export function cuaBootstrapCommand(): string {
  return [
    "set -eu",
    'IMAGE_LAUNCHER="/opt/autopr/bin/autopr-cua-gateway"',
    'if [ -x "$IMAGE_LAUNCHER" ]; then exec "$IMAGE_LAUNCHER"; fi',
    'echo "AutoPR CUA gateway is missing from this sandbox image; rebuild and roll out the provider template." >&2',
    "exit 127",
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
    const sandboxHome = sandboxUserHome(sandboxOptions.provider ?? "daytona");
    const result = await executeSandboxCommand(cuaBootstrapCommand(), {
      cwd: sandboxHome,
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
      throw new Error(`Could not start the CUA gateway in the sandbox: ${diagnostic}`);
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

async function ensureDesktopPointer(
  sandbox: DaytonaSandbox,
  sandboxOptions: SandboxSessionOptions,
  display: string,
  mode: "native" | "overlay",
): Promise<void> {
  const setupKey = `${display}:${mode}`;
  const sandboxSetups = desktopPointerSetupPromises.get(sandbox) ?? new Map<string, Promise<void>>();
  desktopPointerSetupPromises.set(sandbox, sandboxSetups);
  const existing = sandboxSetups.get(setupKey);
  if (existing) return await existing;

  const theme = mode === "overlay" ? "AutoPRHidden" : "Adwaita";
  const sandboxHome = sandboxUserHome(sandboxOptions.provider ?? "daytona");
  const pending = executeSandboxCommand([
    "set -eu",
    `export XCURSOR_THEME="${theme}"`,
    'if command -v xfconf-query >/dev/null 2>&1; then',
    `  xfconf-query -c xsettings -p /Gtk/CursorThemeName -s "${theme}" >/dev/null 2>&1 || true`,
    '  xfconf-query -c xsettings -p /Gtk/CursorThemeSize -s 32 >/dev/null 2>&1 || true',
    "fi",
    mode === "overlay"
      ? 'if command -v xsetroot >/dev/null 2>&1; then xsetroot -xcf /usr/share/icons/AutoPRHidden/cursors/left_ptr 32; fi'
      : 'if command -v xsetroot >/dev/null 2>&1; then xsetroot -cursor_name left_ptr; fi',
  ].join("\n"), {
    cwd: sandboxHome,
    timeout: 15,
    env: { DISPLAY: display },
    sandboxOptions: {
      ...sandboxOptions,
      cacheKey: sandbox.id,
      sandboxId: sandbox.id,
    },
  }).then((result) => {
    if (result.timedOut || result.exitCode !== 0) {
      const diagnostic = result.stderr || result.stdout || result.output || "unknown pointer setup failure";
      throw new Error(`Could not configure the ${mode} sandbox pointer mode: ${diagnostic}`);
    }
  });

  sandboxSetups.set(setupKey, pending);
  try {
    await pending;
  } catch (error) {
    sandboxSetups.delete(setupKey);
    throw error;
  }
}

export class CuaComputerClient {
  private sandbox: DaytonaSandbox;
  private baseUrl?: string;
  private baseUrlExpiresAt = 0;
  private baseUrlPromise?: Promise<string>;
  private commandNames?: Set<string>;
  private readyStatus?: CuaServerStatus;
  private readyStatusExpiresAt = 0;
  private readonly display: string;
  private readonly serverPort: number;
  private readonly requestTimeoutMs: number;

  constructor(
    sandbox: DaytonaSandbox,
    private readonly sandboxOptions: SandboxSessionOptions,
    options: CuaComputerOptions = {},
  ) {
    this.sandbox = sandbox;
    this.display = options.display ?? process.env.DAYTONA_DISPLAY ?? ":1";
    this.serverPort = validateServerPort(options.serverPort ?? DEFAULT_CUA_SERVER_PORT);
    this.requestTimeoutMs = validateRequestTimeout(
      options.requestTimeoutMs ?? DEFAULT_CUA_REQUEST_TIMEOUT_MS,
    );
  }

  /** Keeps a turn-scoped CUA session attached when the provider refreshes its SDK wrapper. */
  updateSandbox(sandbox: DaytonaSandbox): void {
    if (sandbox.id !== this.sandbox.id) {
      this.invalidateConnection();
    }
    this.sandbox = sandbox;
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

  private invalidateConnection(): void {
    this.baseUrl = undefined;
    this.baseUrlExpiresAt = 0;
    this.readyStatus = undefined;
    this.readyStatusExpiresAt = 0;
  }

  private rememberReady(status: CuaServerStatus): CuaServerStatus {
    this.readyStatus = status;
    this.readyStatusExpiresAt = Date.now() + CUA_READY_CACHE_MS;
    return status;
  }

  private async request(
    path: string,
    init: RequestInit,
    retryTransientFailure: boolean,
  ): Promise<{ body: string; response: Response; retries: number }> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { body, response } = await fetchTextWithTimeout(
          await this.url(path),
          init,
          this.requestTimeoutMs,
        );
        const refreshPreview = REFRESHABLE_PREVIEW_HTTP_STATUSES.has(response.status);
        const retryTransient = retryTransientFailure && RETRYABLE_HTTP_STATUSES.has(response.status);
        if (attempt === 0 && (refreshPreview || retryTransient)) {
          this.invalidateConnection();
          continue;
        }
        return { body, response, retries: attempt };
      } catch (error) {
        lastError = error;
        this.invalidateConnection();
        if (attempt === 0 && retryTransientFailure) continue;
        throw error;
      }
    }

    throw lastError ?? new Error(`CUA gateway ${path} request failed.`);
  }

  private async getJson(path: string): Promise<unknown> {
    const { body, response } = await this.request(
      path,
      { headers: { Accept: "application/json" } },
      true,
    );
    if (!response.ok) {
      throw new Error(`CUA gateway ${path} failed with HTTP ${response.status}.`);
    }
    return JSON.parse(body) as unknown;
  }

  async status(): Promise<CuaServerStatus> {
    const payload = await this.getJson("/status");
    if (!isRecord(payload) || payload.status !== "ok") {
      throw new Error("CUA gateway status response was invalid.");
    }
    return payload as CuaServerStatus;
  }

  async command(command: string, params?: Record<string, unknown>): Promise<CuaCommandResponse> {
    const { body, response, retries } = await this.request(
      "/cmd",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params && Object.keys(params).length > 0
          ? { command, params }
          : { command }),
      },
      IDEMPOTENT_CUA_COMMANDS.has(command),
    );
    if (!response.ok) {
      this.invalidateConnection();
      try {
        parseCuaCommandResponse(body);
      } catch (error) {
        throw new Error(
          `CUA gateway command ${command} failed with HTTP ${response.status}: ${errorMessage(error)}`,
        );
      }
      throw new Error(`CUA gateway command ${command} failed with HTTP ${response.status}.`);
    }
    let result: CuaCommandResponse;
    try {
      result = parseCuaCommandResponse(body);
    } catch (error) {
      this.readyStatus = undefined;
      this.readyStatusExpiresAt = 0;
      throw error;
    }
    if (result.effect === "refused") {
      const detail = typeof result.text === "string"
        ? result.text
        : `CUA reported action effect ${result.effect}`;
      throw new Error(`CUA command ${command} was refused: ${detail}`);
    }
    return retries > 0 ? { ...result, transport_retries: retries } : result;
  }

  supports(command: string): boolean {
    return this.commandNames?.has(command) === true;
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
        reason: "CUA Driver is unavailable; native computer use and sandbox recording remain active.",
      };
    }
    if (!REQUIRED_CUA_AGENT_CURSOR_COMMANDS.every((command) => capabilities.includes(command))) {
      const missing = REQUIRED_CUA_AGENT_CURSOR_COMMANDS.filter(
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
      implicit: state?.implicit === true,
      labelVisible: typeof state?.label_visible === "boolean"
        ? state.label_visible
        : undefined,
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
      throw new Error(`Expected the CUA gateway on Linux, received ${status.os_type}.`);
    }
    const commandManifest = isRecord(commands) ? commands.commands : undefined;
    if (!isRecord(commandManifest)) {
      throw new Error("CUA gateway command manifest was invalid.");
    }
    const missing = REQUIRED_CUA_COMMANDS.filter((command) => !(command in commandManifest));
    if (missing.length > 0) {
      throw new Error(`CUA gateway is missing required commands: ${missing.join(", ")}.`);
    }
    this.commandNames = new Set(Object.keys(commandManifest));
    if (version.package !== CUA_GATEWAY_PACKAGE) {
      const received = typeof version.package === "string" ? version.package : "unknown";
      throw new Error(
        `Expected ${CUA_GATEWAY_PACKAGE}, received ${received}.`,
      );
    }
    const size = isRecord(screen.size) ? screen.size : undefined;
    if (typeof size?.width !== "number" || typeof size.height !== "number") {
      throw new Error("CUA gateway could not read the sandbox desktop size.");
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

  private isLabelSafeCursor(status: CuaServerStatus): boolean {
    const cursor = status.cursor;
    return status.backend === "cua-driver"
      && cursor?.available === true
      && cursor.implicit === true
      && cursor.labelVisible === false
      && cursor.session === undefined
      && cursor.theme === "cua.default"
      && (cursor.runtimeMode === "embedded" || cursor.runtimeMode === "daemon")
      && (cursor.enabled || cursor.runtimeMode === "embedded")
      && !cursor.error;
  }

  private async useSafePointer(status: CuaServerStatus): Promise<CuaServerStatus> {
    if (this.isLabelSafeCursor(status)) {
      await ensureDesktopPointer(
        this.sandbox,
        this.sandboxOptions,
        this.display,
        status.cursor?.enabled ? "overlay" : "native",
      );
      return status;
    }

    let safeStatus = status;
    const cursor = status.cursor;
    if (
      status.backend === "cua-driver"
      && cursor?.enabled
      && cursor.capabilities.includes("set_agent_cursor_enabled")
    ) {
      try {
        await this.command("set_agent_cursor_enabled", { enabled: false });
        safeStatus = {
          ...status,
          cursor: {
            ...cursor,
            enabled: false,
            reason: "The labeled legacy cursor was disabled; the native sandbox pointer is active.",
          },
        };
      } catch (error) {
        throw new Error(
          `Could not disable the labeled legacy cursor: ${errorMessage(error)}`,
        );
      }
    } else if (status.backend === "cua-driver" && cursor?.enabled) {
      throw new Error(
        "CUA Driver has a visible cursor but cannot prove it is unlabeled or disable it safely.",
      );
    }

    await ensureDesktopPointer(this.sandbox, this.sandboxOptions, this.display, "native");
    return safeStatus;
  }

  async ensureReady(): Promise<CuaServerStatus> {
    if (this.readyStatus && Date.now() < this.readyStatusExpiresAt) {
      return this.readyStatus;
    }

    let initialStatus: CuaServerStatus | undefined;
    try {
      initialStatus = await this.inspect();
      if (this.isLabelSafeCursor(initialStatus)) {
        return this.rememberReady(await this.useSafePointer(initialStatus));
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
      }).catch((error: unknown) => {
        if (cuaCursorRecoveryAttemptedAt.get(recoveryKey) === attemptedAt) {
          cuaCursorRecoveryAttemptedAt.delete(recoveryKey);
        }
        throw error;
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
        // A healthy native or labeled legacy server is still degraded on a
        // implicit-session-capable image. Let the image launcher replace it before the next
        // action, especially before the sandbox starts recording.
        await recovery;
      } catch (error) {
        if (initialStatus) {
          const safeInitialStatus = await this.useSafePointer(initialStatus);
          return this.rememberReady({
            ...safeInitialStatus,
            cursor: safeInitialStatus.cursor
              ? {
                  ...safeInitialStatus.cursor,
                  recoveryAttempted: true,
                  error: safeInitialStatus.cursor.error
                    ? `${safeInitialStatus.cursor.error} Recovery failed: ${errorMessage(error)}`
                    : `CUA Driver cursor recovery failed: ${errorMessage(error)}`,
                }
              : safeInitialStatus.cursor,
          });
        }
        throw error;
      }
    } else if (initialStatus) {
      return this.rememberReady(await this.useSafePointer(initialStatus));
    }

    const deadline = Date.now() + CUA_SERVER_READY_TIMEOUT_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const recovered = await this.useSafePointer(await this.inspect());
        return this.rememberReady({
          ...recovered,
          cursor: recovered.cursor
            ? { ...recovered.cursor, recoveryAttempted }
            : recovered.cursor,
        });
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, CUA_SERVER_READY_POLL_MS));
      }
    }

    throw new Error(
      `CUA gateway did not become ready: ${errorMessage(lastError ?? "readiness timeout")}`,
    );
  }
}
