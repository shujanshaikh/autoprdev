import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CuaComputerClient,
  cuaBootstrapCommand,
  parseCuaCommandResponse,
} from "./cua-client";
import type { DaytonaSandbox } from "../sandbox";

const executeMocks = vi.hoisted(() => ({
  executeSandboxCommand: vi.fn(),
}));

vi.mock("../sandbox/execute", () => ({
  executeSandboxCommand: executeMocks.executeSandboxCommand,
}));

beforeEach(() => {
  executeMocks.executeSandboxCommand.mockResolvedValue({
    exitCode: 0,
    timedOut: false,
    stdout: "",
    stderr: "",
    output: "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  executeMocks.executeSandboxCommand.mockReset();
});

describe("CUA computer-server response parsing", () => {
  it("generates a syntactically valid legacy bootstrap script", () => {
    const bootstrap = cuaBootstrapCommand();
    const result = spawnSync("bash", ["-n"], {
      encoding: "utf8",
      input: bootstrap,
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(bootstrap.indexOf("/opt/autopr/bin/autopr-cua-computer-server")).toBeLessThan(
      bootstrap.indexOf("VERSION_RESPONSE"),
    );
  });

  it("keeps CUA's daemon backend while suppressing its branded overlay", () => {
    const launcher = readFileSync(
      new URL("../../../../infra/daytona/autopr/autopr-cua-computer-server", import.meta.url),
      "utf8",
    );
    const compatibilityPatch = readFileSync(
      new URL("../../../../infra/daytona/autopr/cua-computer-server-agent-cursor.patch", import.meta.url),
      "utf8",
    );
    const dockerfile = readFileSync(
      new URL("../../../../infra/daytona/autopr/Dockerfile", import.meta.url),
      "utf8",
    );
    const desktopSession = readFileSync(
      new URL("../../../../infra/daytona/autopr/desktop/autopr-desktop-session", import.meta.url),
      "utf8",
    );
    expect(launcher).toContain('nohup "$CUA_DRIVER_BIN" serve');
    expect(launcher).toContain('flock 9');
    expect(launcher.indexOf('flock 9')).toBeLessThan(launcher.indexOf('if is_ready; then'));
    expect(launcher.match(/9>&-/g)).toHaveLength(2);
    expect(launcher).toContain('kill -KILL "$pid"');
    expect(launcher).toContain("--driver-mode daemon");
    expect(launcher).toContain('"command":"set_agent_cursor_enabled","params":{"enabled":false}');
    expect(launcher).toContain(".enabled == false");
    expect(launcher).toContain("set_cursor_theme Adwaita");
    expect(launcher).not.toContain('CUA_DRIVER_SESSION_ID="${CUA_DRIVER_SESSION_ID:-AutoPR}"');
    expect(launcher).not.toContain("--driver-mode embedded");
    expect(compatibilityPatch).toContain('"cursor_id": self._session_id');
    expect(compatibilityPatch).toContain("data = self._result_data(state)");
    expect(compatibilityPatch).toContain('data["overlay"] = self._agent_cursor_overlay_window()');
    expect(compatibilityPatch).toContain(
      'title != f"Cua.AgentCursorOverlay.{self._session_id}"',
    );
    expect(compatibilityPatch).toContain('"method": "x11_stable_overlay_delta"');
    expect(compatibilityPatch).toContain("for hidden_a, visible_a, visible_b, hidden_b");
    expect(compatibilityPatch).toContain("ImageGrab.grab, bbox=box");
    expect(dockerfile).toMatch(/sha256sum -c - \\\n\s+&& tar -xzf/);
    expect(dockerfile).toContain("XCURSOR_THEME=Adwaita");
    expect(desktopSession).toContain('CURSOR_THEME="Adwaita"');
    expect(desktopSession).toContain("xsetroot -cursor_name left_ptr");
    expect(desktopSession).not.toContain("xsetroot -xcf /usr/share/icons/AutoPRHidden");
  });

  it("rotates the system cue around the gear center", () => {
    const builder = fileURLToPath(
      new URL("../../../../infra/daytona/autopr/cursor-theme/build_theme.py", import.meta.url),
    );
    const result = spawnSync("python3", [
      "-c",
      [
        "import json, runpy, sys",
        "animation = runpy.run_path(sys.argv[1])['action_system']()",
        "layers = [layer for layer in animation['layers'] if layer['nm'].startswith('System')]",
        "print(json.dumps([[layer['ks']['a']['k'], layer['ks']['p']['k']] for layer in layers]))",
      ].join("; "),
      builder,
    ], { encoding: "utf8" });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      Array.from({ length: 6 }, () => [[29, 39], [15, 39]]),
    );
  });

  it("installs and validates computer-server's complete pinned CUA runtime", () => {
    const dockerfile = readFileSync(
      new URL("../../../../infra/daytona/autopr/Dockerfile", import.meta.url),
      "utf8",
    );
    const compatibilityPatch = readFileSync(
      new URL("../../../../infra/daytona/autopr/cua-computer-server-agent-cursor.patch", import.meta.url),
      "utf8",
    );
    expect(dockerfile).toContain('uv build --wheel --out-dir "$cua_wheels"');
    expect(dockerfile).toContain('cua_core-${CUA_CORE_VERSION}-py3-none-any.whl');
    expect(dockerfile).toContain('cua_auto-${CUA_AUTO_VERSION}-py3-none-any.whl');
    expect(dockerfile).toContain(
      'cua_computer_server-${CUA_COMPUTER_SERVER_VERSION}-py3-none-any.whl',
    );
    expect(dockerfile).toContain('uv pip install --python /opt/autopr/cua/bin/python --no-cache');
    expect(dockerfile).not.toContain("--no-editable");
    expect(dockerfile).toContain("import cua_auto, cua_core");
    expect(dockerfile).toContain("from cua_core.telemetry import record_event");
    expect(dockerfile).toContain("PYNPUT_BACKEND=dummy");
    expect(dockerfile).toContain('cursor_theme_inspection="$(');
    expect(dockerfile).not.toContain(
      'cua-cursor-theme" inspect "${theme_build}/dev.autopr.cursor.neon.cua-theme" | grep -q',
    );
    expect(compatibilityPatch).toContain('cua-core = { path = "../core" }');
    expect(compatibilityPatch).toContain('cua-auto = { path = "../cua-auto" }');
    expect(dockerfile.indexOf('rm -rf "$cua_source"')).toBeLessThan(
      dockerfile.indexOf("import cua_auto, cua_core"),
    );
    expect(dockerfile.indexOf('rm -rf "$cua_source" "$cua_wheels"')).toBeLessThan(
      dockerfile.indexOf("import cua_auto, cua_core"),
    );
  });

  it("parses the first successful SSE data frame", () => {
    expect(parseCuaCommandResponse(
      ': keep-alive\ndata: {"success":true,"size":{"width":1920,"height":1080}}\n\n',
    )).toEqual({
      success: true,
      size: { width: 1920, height: 1080 },
    });
  });

  it("surfaces CUA command failures", () => {
    expect(() => parseCuaCommandResponse(
      'data: {"success":false,"error":"X11 display is unavailable"}\n\n',
    )).toThrow("CUA computer-server command failed: X11 display is unavailable");
  });

  it("rejects malformed and missing SSE payloads", () => {
    expect(() => parseCuaCommandResponse("data: not-json\n\n"))
      .toThrow("CUA computer-server returned invalid JSON");
    expect(() => parseCuaCommandResponse('{"success":true}'))
      .toThrow("CUA computer-server returned no SSE data frame");
  });
});

describe("CUA client configuration", () => {
  const sandbox = {} as DaytonaSandbox;
  const requiredCommandNames = [
    "version", "open", "get_current_window_id", "get_window_name", "get_window_size",
    "get_window_position", "move_cursor", "left_click", "right_click", "mouse_down",
    "mouse_up", "double_click", "drag", "scroll_direction", "type_text", "press_key",
    "hotkey", "screenshot", "get_cursor_position", "get_screen_size",
  ];
  const cursorCommandNames = [
    "set_agent_cursor_enabled", "get_agent_cursor_state",
  ];
  const recordingMotion = {
    start_handle: 0.3,
    end_handle: 0.3,
    arc_size: 0.3,
    arc_flow: 0.12,
    spring: 0.62,
    glide_duration_ms: 480,
    dwell_after_click_ms: 260,
    idle_hide_ms: 0,
    turn_radius: 80,
  };

  it("rejects privileged and invalid computer-server ports", () => {
    expect(() => new CuaComputerClient(sandbox, {}, { serverPort: 80 }))
      .toThrow("Invalid CUA computer-server port: 80");
    expect(() => new CuaComputerClient(sandbox, {}, { serverPort: 65_536 }))
      .toThrow("Invalid CUA computer-server port: 65536");
  });

  it("rejects unsafe request timeouts", () => {
    expect(() => new CuaComputerClient(sandbox, {}, { requestTimeoutMs: 500 }))
      .toThrow("Invalid CUA request timeout: 500");
    expect(() => new CuaComputerClient(sandbox, {}, { requestTimeoutMs: 120_001 }))
      .toThrow("Invalid CUA request timeout: 120001");
  });

  it("fails closed on Driver refusals while preserving suspected no-op evidence", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        'data: {"success":true,"effect":"refused","text":"permission denied"}\n\n',
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"success":true,"effect":"suspected_noop","verified":false}\n\n',
      ));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CuaComputerClient(
      { getSignedPreviewUrl } as unknown as DaytonaSandbox,
      {},
    );

    await expect(client.command("left_click", { x: 1, y: 2 }))
      .rejects.toThrow("CUA command left_click was refused: permission denied");
    await expect(client.command("left_click", { x: 1, y: 2 })).resolves.toMatchObject({
      effect: "suspected_noop",
      verified: false,
    });
  });

  it("shares one signed preview URL across concurrent inspection requests", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commandNames = [...requiredCommandNames];
    commandNames.push("get_desktop_state");
    vi.stubGlobal("fetch", vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/status")) {
        return Response.json({ status: "ok", os_type: "linux" });
      }
      if (path.endsWith("/commands")) {
        return Response.json({
          commands: Object.fromEntries(commandNames.map((name) => [name, { params: [] }])),
        });
      }
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { command?: string } : {};
      if (body.command === "get_screen_size") {
        return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
      }
      return new Response('data: {"success":true,"protocol":1,"package":"0.3.42"}\n\n');
    }));

    const client = new CuaComputerClient({ getSignedPreviewUrl } as unknown as DaytonaSandbox, {});
    await expect(client.inspect()).resolves.toEqual({
      status: "ok",
      os_type: "linux",
      backend: "cua-driver",
      cursor: {
        available: false,
        enabled: false,
        capabilities: [],
        reason: expect.stringContaining("does not expose the required agent cursor commands"),
      },
    });
    expect(getSignedPreviewUrl).toHaveBeenCalledTimes(1);
  });

  it("detects cursor capabilities and disables the branded overlay once per live session", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commandNames = [...requiredCommandNames, "get_desktop_state", ...cursorCommandNames];
    let enabled = true;
    const theme = "cua.default";
    const reducedMotion = "auto";
    const motion = recordingMotion;
    const commands: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/status")) {
        return Response.json({ status: "ok", os_type: "linux" });
      }
      if (path.endsWith("/commands")) {
        return Response.json({
          commands: Object.fromEntries(commandNames.map((name) => [name, { params: [] }])),
        });
      }
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as {
            command?: string;
            params?: Record<string, boolean | number | string> & { enabled?: boolean };
          }
        : {};
      const command = body.command ?? "";
      commands.push(command);
      if (command === "get_screen_size") {
        return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
      }
      if (command === "version") {
        return new Response('data: {"success":true,"package":"0.3.42"}\n\n');
      }
      if (command === "set_agent_cursor_enabled") enabled = body.params?.enabled === true;
      if (command === "get_agent_cursor_state") {
        return new Response(
          `data: ${JSON.stringify({
            success: true,
            session: "computer-server-1",
            enabled,
            theme: { id: theme, reduced_motion: reducedMotion },
            motion,
            visual_state: { resolved_action: "idle", phase: "loop" },
            runtime_mode: "daemon",
            render_ready: enabled,
            capture_ready: enabled,
            capture: { method: "x11_stable_overlay_delta", changed_pixels: enabled ? 900 : 0 },
            overlay: { mapped: enabled, painted: enabled, bounding_rectangles: enabled ? 4 : 0 },
          })}\n\n`,
        );
      }
      return new Response('data: {"success":true}\n\n');
    }));

    const client = new CuaComputerClient({ getSignedPreviewUrl } as unknown as DaytonaSandbox, {});
    await expect(client.ensureReady()).resolves.toMatchObject({
      backend: "cua-driver",
      cursor: {
        available: true,
        enabled: false,
        session: "computer-server-1",
        theme: "cua.default",
        reducedMotion: "auto",
        motion: recordingMotion,
        visualState: { resolved_action: "idle", phase: "loop" },
        runtimeMode: "daemon",
        renderReady: false,
        captureReady: false,
        capture: { method: "x11_stable_overlay_delta", changed_pixels: 0 },
        overlay: { mapped: false, painted: false, bounding_rectangles: 0 },
        reason: expect.stringContaining("native desktop pointer"),
      },
    });
    await expect(client.ensureReady()).resolves.toMatchObject({
      cursor: { available: true, enabled: false },
    });
    expect(commands.filter((command) => command === "set_agent_cursor_enabled")).toHaveLength(1);
    expect(commands).not.toContain("set_agent_cursor_theme");
    expect(commands).not.toContain("set_agent_cursor_motion");
    expect(commands).not.toContain("probe_agent_cursor");
  });

  it("disables the overlay again when a restarted server reports it enabled", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commandNames = [...requiredCommandNames, "get_desktop_state", ...cursorCommandNames];
    let enabled = true;
    let disableCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/status")) return Response.json({ status: "ok", os_type: "linux" });
      if (path.endsWith("/commands")) {
        return Response.json({
          commands: Object.fromEntries(commandNames.map((name) => [name, { params: [] }])),
        });
      }
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as {
            command?: string;
            params?: Record<string, boolean | number | string> & { enabled?: boolean };
          }
        : {};
      if (body.command === "version") {
        return new Response('data: {"success":true,"package":"0.3.42"}\n\n');
      }
      if (body.command === "get_screen_size") {
        return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
      }
      if (body.command === "set_agent_cursor_enabled") {
        enabled = body.params?.enabled === true;
        disableCalls += 1;
      }
      if (body.command === "get_agent_cursor_state") {
        return new Response(
          `data: ${JSON.stringify({
            success: true,
            session: `generation-${disableCalls}`,
            enabled,
            theme: { id: "cua.default", reduced_motion: "auto" },
            motion: recordingMotion,
            runtime_mode: "daemon",
            render_ready: enabled,
            capture_ready: enabled,
            capture: { method: "x11_stable_overlay_delta", changed_pixels: enabled ? 900 : 0 },
            overlay: { mapped: enabled, painted: enabled },
          })}\n\n`,
        );
      }
      return new Response('data: {"success":true}\n\n');
    }));

    const client = new CuaComputerClient({ getSignedPreviewUrl } as unknown as DaytonaSandbox, {});
    await client.ensureReady();
    enabled = true;
    await client.ensureReady();
    expect(disableCalls).toBe(2);
  });

  it("does not require a painted overlay after disabling it", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commandNames = [...requiredCommandNames, "get_desktop_state", ...cursorCommandNames];
    vi.stubGlobal("fetch", vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/status")) return Response.json({ status: "ok", os_type: "linux" });
      if (path.endsWith("/commands")) {
        return Response.json({
          commands: Object.fromEntries(commandNames.map((name) => [name, { params: [] }])),
        });
      }
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { command?: string; params?: { enabled?: boolean } }
        : {};
      if (body.command === "version") {
        return new Response('data: {"success":true,"package":"0.3.42"}\n\n');
      }
      if (body.command === "get_screen_size") {
        return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
      }
      if (body.command === "set_agent_cursor_enabled") {
        return new Response('data: {"success":true,"enabled":false}\n\n');
      }
      if (body.command === "get_agent_cursor_state") {
        return new Response(`data: ${JSON.stringify({
          success: true,
          session: "computer-use",
          enabled: false,
          theme: { id: "dev.autopr.cursor.neon", reduced_motion: "off" },
          motion: recordingMotion,
          runtime_mode: "daemon",
          render_ready: false,
          capture_ready: false,
          capture: { method: "x11_stable_overlay_delta", changed_pixels: 0 },
          overlay: { mapped: true, painted: true },
        })}\n\n`);
      }
      return new Response('data: {"success":true}\n\n');
    }));

    const client = new CuaComputerClient({
      id: "capture-miss-sandbox",
      getSignedPreviewUrl,
    } as unknown as DaytonaSandbox, {});
    await expect(client.ensureReady()).resolves.toMatchObject({
      backend: "cua-driver",
      cursor: {
        enabled: false,
        runtimeMode: "daemon",
        renderReady: false,
        captureReady: false,
      },
    });
    expect(executeMocks.executeSandboxCommand).toHaveBeenCalledTimes(1);
    expect(executeMocks.executeSandboxCommand.mock.calls[0]?.[0]).toContain(
      "xsetroot -cursor_name left_ptr",
    );
  });

  it("keeps native fallback available while reporting that the agent cursor is unavailable", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commands: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/status")) return Response.json({ status: "ok", os_type: "linux" });
      if (path.endsWith("/commands")) {
        return Response.json({
          commands: Object.fromEntries(requiredCommandNames.map((name) => [name, { params: [] }])),
        });
      }
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { command?: string }
        : {};
      commands.push(body.command ?? "");
      if (body.command === "version") {
        return new Response('data: {"success":true,"package":"0.3.42"}\n\n');
      }
      return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
    }));

    const client = new CuaComputerClient({
      id: "native-fallback-sandbox",
      getSignedPreviewUrl,
    } as unknown as DaytonaSandbox, {});
    await expect(client.ensureReady()).resolves.toMatchObject({
      backend: "native",
      cursor: {
        available: false,
        enabled: false,
        recoveryAttempted: true,
        reason: expect.stringContaining("native computer use and Daytona recording remain active"),
      },
    });
    expect(executeMocks.executeSandboxCommand).toHaveBeenCalledTimes(2);
    expect(commands).not.toContain("set_agent_cursor_enabled");
  });

  it("joins an in-flight cursor recovery before concurrent callers can continue", async () => {
    let finishRecovery: (() => void) | undefined;
    executeMocks.executeSandboxCommand.mockImplementationOnce(() => new Promise((resolve) => {
      finishRecovery = () => resolve({
        exitCode: 0,
        timedOut: false,
        stdout: "",
        stderr: "",
        output: "",
      });
    }));
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    vi.stubGlobal("fetch", vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/status")) return Response.json({ status: "ok", os_type: "linux" });
      if (path.endsWith("/commands")) {
        return Response.json({
          commands: Object.fromEntries(requiredCommandNames.map((name) => [name, { params: [] }])),
        });
      }
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as { command?: string }
        : {};
      if (body.command === "version") {
        return new Response('data: {"success":true,"package":"0.3.42"}\n\n');
      }
      return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
    }));

    const client = new CuaComputerClient({
      id: "concurrent-recovery-sandbox",
      getSignedPreviewUrl,
    } as unknown as DaytonaSandbox, {});
    const first = client.ensureReady();
    const second = client.ensureReady();
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    await vi.waitFor(() => expect(executeMocks.executeSandboxCommand).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    finishRecovery?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ backend: "native" }),
      expect.objectContaining({ backend: "native" }),
    ]);
  });
});
