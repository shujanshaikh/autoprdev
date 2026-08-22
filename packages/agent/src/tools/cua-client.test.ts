import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

describe("CUA gateway response parsing", () => {
  it("generates a syntactically valid image-launcher bootstrap script", () => {
    const bootstrap = cuaBootstrapCommand();
    const result = spawnSync("bash", ["-n"], {
      encoding: "utf8",
      input: bootstrap,
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(bootstrap).toContain("/opt/autopr/bin/autopr-cua-gateway");
    expect(bootstrap).toContain("rebuild and roll out the Daytona snapshot");
    expect(bootstrap).not.toContain("pip install");
  });

  it("uses the official CUA SDK directly behind a thin gateway", () => {
    const launcher = readFileSync(
      new URL("../../../../infra/daytona/autopr/autopr-cua-gateway", import.meta.url),
      "utf8",
    );
    const gateway = readFileSync(
      new URL("../../../../infra/daytona/autopr/cua_gateway.py", import.meta.url),
      "utf8",
    );
    const dockerfile = readFileSync(
      new URL("../../../../infra/daytona/autopr/Dockerfile", import.meta.url),
      "utf8",
    );
    const pythonSyntax = spawnSync("python3", ["-c", "compile(__import__('sys').stdin.read(), 'cua_gateway.py', 'exec')"], {
      encoding: "utf8",
      input: gateway,
    });
    expect(pythonSyntax.stderr).toBe("");
    expect(pythonSyntax.status).toBe(0);
    expect(gateway).toContain("from cua_driver import (");
    expect(gateway).toContain("CuaDriver.connect(self._socket_path)");
    expect(gateway).toContain("asyncio.wait_for(driver.metadata()");
    expect(gateway).toContain('ActionTarget.DESKTOP(display_id="primary")');
    expect(gateway).not.toContain("StartSessionInput");
    expect(gateway).toContain("await self._driver.get_desktop_state(");
    expect(gateway).toContain("await self._driver.clipboard_read(");
    expect(gateway).not.toContain("computer_server");
    expect(launcher).toContain('nohup "$CUA_DRIVER_BIN" serve');
    expect(launcher).toContain('status --socket "$CUA_DRIVER_SOCKET"');
    expect(launcher).toContain('"$CUA_RUNTIME/bin/python" "$CUA_GATEWAY"');
    expect(launcher).toContain('flock 9');
    expect(launcher.indexOf('flock 9')).toBeLessThan(launcher.indexOf('if is_gateway_ready; then'));
    expect(launcher.match(/9>&-/g)).toHaveLength(2);
    expect(launcher).toContain('kill -KILL "$pid"');
    expect(launcher).toContain('readlink -f "/proc/${pid}/exe"');
    expect(launcher).toContain("mapfile -d '' -t argv");
    expect(launcher).toContain("--cursor-theme cua.default");
    expect(launcher).toContain('{"command":"get_cursor_position"}');
    expect(launcher).toContain("{command:\"move_cursor\",params:{x:$x,y:$y}}");
    expect(launcher).toContain(".implicit == true");
    expect(launcher).toContain(".session == null");
    expect(launcher).toContain(".label_visible == false");
    expect(launcher).not.toContain("CUA_DRIVER_SESSION_ID");
    expect(dockerfile).toContain("ARG CUA_DRIVER_VERSION=0.20.0");
    expect(dockerfile).toContain('"cua-driver==${CUA_DRIVER_VERSION}"');
    expect(dockerfile).toContain("/opt/autopr/cua-gateway/cua_gateway.py");
    expect(dockerfile).not.toContain("cua-computer-server");
    expect(dockerfile).not.toContain("cua_source");
    expect(dockerfile).not.toContain("git apply");
  });

  it("parses gateway JSON and legacy SSE during snapshot rollout", () => {
    expect(parseCuaCommandResponse(
      '{"success":true,"size":{"width":1920,"height":1080}}',
    )).toMatchObject({ success: true, size: { width: 1920, height: 1080 } });
    expect(parseCuaCommandResponse(
      ': keep-alive\ndata: {"success":true,"size":{"width":1920,"height":1080}}\n\n',
    )).toEqual({
      success: true,
      size: { width: 1920, height: 1080 },
    });
  });

  it("surfaces CUA command failures", () => {
    expect(() => parseCuaCommandResponse(
      '{"success":false,"error":"X11 display is unavailable"}',
    )).toThrow("CUA gateway command failed: X11 display is unavailable");
  });

  it("rejects malformed and missing command payloads", () => {
    expect(() => parseCuaCommandResponse("not-json"))
      .toThrow("CUA gateway returned no JSON command result");
    expect(() => parseCuaCommandResponse("data: not-json\n\n"))
      .toThrow("CUA gateway returned invalid JSON");
  });
});

describe("CUA client configuration", () => {
  const sandbox = {} as DaytonaSandbox;
  const requiredCommandNames = [
    "version", "open", "get_current_window_id", "get_application_windows", "get_window_name", "get_window_size",
    "get_window_position", "activate_window", "maximize_window", "move_cursor", "left_click", "middle_click", "right_click",
    "double_click", "drag", "scroll_direction", "type_text", "press_key",
    "hotkey", "screenshot", "get_cursor_position", "get_screen_size", "copy_to_clipboard", "set_clipboard",
  ];
  const cursorCommandNames = [
    "get_agent_cursor_state",
  ];

  it("rejects privileged and invalid gateway ports", () => {
    expect(() => new CuaComputerClient(sandbox, {}, { serverPort: 80 }))
      .toThrow("Invalid CUA gateway port: 80");
    expect(() => new CuaComputerClient(sandbox, {}, { serverPort: 65_536 }))
      .toThrow("Invalid CUA gateway port: 65536");
  });

  it("rejects unsafe request timeouts", () => {
    expect(() => new CuaComputerClient(sandbox, {}, { requestTimeoutMs: 500 }))
      .toThrow("Invalid CUA gateway request timeout: 500");
    expect(() => new CuaComputerClient(sandbox, {}, { requestTimeoutMs: 120_001 }))
      .toThrow("Invalid CUA gateway request timeout: 120001");
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

  it("refreshes the signed URL and retries one safe CUA observation request", async () => {
    const getSignedPreviewUrl = vi.fn()
      .mockResolvedValueOnce({ url: "https://cua.test/expired/" })
      .mockResolvedValueOnce({ url: "https://cua.test/fresh/" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(
        'data: {"success":true,"size":{"width":1920,"height":1080}}\n\n',
      ));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CuaComputerClient(
      { getSignedPreviewUrl } as unknown as DaytonaSandbox,
      {},
    );

    await expect(client.command("get_screen_size")).resolves.toMatchObject({
      success: true,
      transport_retries: 1,
    });
    expect(getSignedPreviewUrl).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/expired/cmd");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/fresh/cmd");
  });

  it("does not replay a mutating CUA command after an ambiguous transient failure", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const fetchMock = vi.fn(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CuaComputerClient(
      { getSignedPreviewUrl } as unknown as DaytonaSandbox,
      {},
    );

    await expect(client.command("left_click", { x: 1, y: 2 }))
      .rejects.toThrow("failed with HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
        return Response.json({ success: true, size: { width: 1920, height: 1080 } });
      }
      return Response.json({
        success: true,
        protocol: 1,
        package: "autopr-cua-gateway",
        version: "1.0.0",
        driver_version: "0.20.0",
      });
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

  it("accepts an unlabeled implicit 0.20 cursor and masks the hardware pointer", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commandNames = [...requiredCommandNames, "get_desktop_state", ...cursorCommandNames];
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
          }
        : {};
      const command = body.command ?? "";
      commands.push(command);
      if (command === "get_screen_size") {
        return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
      }
      if (command === "version") {
        return new Response('data: {"success":true,"package":"autopr-cua-gateway"}\n\n');
      }
      if (command === "get_agent_cursor_state") {
        return new Response(
          `data: ${JSON.stringify({
            success: true,
            session: null,
            implicit: true,
            label_visible: false,
            enabled: true,
            theme: { id: "cua.default" },
            runtime_mode: "daemon",
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
        enabled: true,
        implicit: true,
        labelVisible: false,
        theme: "cua.default",
        runtimeMode: "daemon",
      },
    });
    await expect(client.ensureReady()).resolves.toMatchObject({
      cursor: { available: true, enabled: true, implicit: true, labelVisible: false },
    });
    expect(executeMocks.executeSandboxCommand).toHaveBeenCalledTimes(1);
    expect(executeMocks.executeSandboxCommand.mock.calls[0]?.[0]).toContain(
      "xsetroot -xcf /usr/share/icons/AutoPRHidden/cursors/left_ptr 32",
    );
    expect(commands).not.toContain("set_agent_cursor_enabled");
    expect(commands).not.toContain("set_agent_cursor_theme");
    expect(commands).not.toContain("set_agent_cursor_motion");
    expect(commands).not.toContain("probe_agent_cursor");
  });

  it("disables a labeled cursor when the gateway cannot prove it is safe", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commandNames = [
      ...requiredCommandNames,
      "get_desktop_state",
      ...cursorCommandNames,
      "set_agent_cursor_enabled",
    ];
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
        return new Response('data: {"success":true,"package":"autopr-cua-gateway"}\n\n');
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
            implicit: false,
            label_visible: true,
            enabled,
            theme: { id: "dev.autopr.cursor.neon", reduced_motion: "off" },
            runtime_mode: "daemon",
          })}\n\n`,
        );
      }
      return new Response('data: {"success":true}\n\n');
    }));

    const client = new CuaComputerClient({ getSignedPreviewUrl } as unknown as DaytonaSandbox, {});
    await expect(client.ensureReady()).resolves.toMatchObject({
      cursor: {
        enabled: false,
        implicit: false,
        labelVisible: true,
        reason: expect.stringContaining("labeled legacy cursor was disabled"),
      },
    });
    expect(disableCalls).toBe(1);
    expect(executeMocks.executeSandboxCommand).toHaveBeenCalledTimes(2);
    expect(executeMocks.executeSandboxCommand.mock.calls[1]?.[0]).toContain(
      "xsetroot -cursor_name left_ptr",
    );
  });

  it("does not enable the native pointer when disabling a labeled cursor fails", async () => {
    executeMocks.executeSandboxCommand.mockRejectedValueOnce(new Error("recovery unavailable"));
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commandNames = [
      ...requiredCommandNames,
      "get_desktop_state",
      ...cursorCommandNames,
      "set_agent_cursor_enabled",
    ];
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
        ? JSON.parse(init.body) as { command?: string }
        : {};
      if (body.command === "version") {
        return new Response('data: {"success":true,"package":"autopr-cua-gateway"}\n\n');
      }
      if (body.command === "get_screen_size") {
        return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
      }
      if (body.command === "get_agent_cursor_state") {
        return new Response(`data: ${JSON.stringify({
          success: true,
          session: "legacy-session",
          implicit: false,
          label_visible: true,
          enabled: true,
          theme: { id: "legacy.labeled" },
          runtime_mode: "daemon",
        })}\n\n`);
      }
      if (body.command === "set_agent_cursor_enabled") {
        return new Response('data: {"success":false,"error":"overlay did not stop"}\n\n');
      }
      return new Response('data: {"success":true}\n\n');
    }));

    const client = new CuaComputerClient({
      id: "legacy-cursor-disable-failure",
      getSignedPreviewUrl,
    } as unknown as DaytonaSandbox, {});
    await expect(client.ensureReady()).rejects.toThrow(
      "Could not disable the labeled legacy cursor: CUA gateway command failed: overlay did not stop",
    );
    expect(executeMocks.executeSandboxCommand).toHaveBeenCalledTimes(1);
  });

  it("restores the native pointer when the implicit overlay is unavailable", async () => {
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
        ? JSON.parse(init.body) as { command?: string }
        : {};
      if (body.command === "version") {
        return new Response('data: {"success":true,"package":"autopr-cua-gateway"}\n\n');
      }
      if (body.command === "get_screen_size") {
        return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
      }
      if (body.command === "get_agent_cursor_state") {
        return new Response(`data: ${JSON.stringify({
          success: true,
          session: null,
          implicit: true,
          label_visible: false,
          enabled: false,
          theme: { id: "cua.default" },
          runtime_mode: "daemon",
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
        implicit: true,
        labelVisible: false,
        runtimeMode: "daemon",
      },
    });
    expect(executeMocks.executeSandboxCommand).toHaveBeenCalledTimes(2);
    expect(executeMocks.executeSandboxCommand.mock.calls[1]?.[0]).toContain(
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
        return new Response('data: {"success":true,"package":"autopr-cua-gateway"}\n\n');
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
        return new Response('data: {"success":true,"package":"autopr-cua-gateway"}\n\n');
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
