import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CuaComputerClient,
  cuaBootstrapCommand,
  parseCuaCommandResponse,
} from "./cua-client";
import type { DaytonaSandbox } from "../sandbox";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CUA computer-server response parsing", () => {
  it("generates a syntactically valid legacy bootstrap script", () => {
    const result = spawnSync("bash", ["-n"], {
      encoding: "utf8",
      input: cuaBootstrapCommand(),
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
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
    "set_agent_cursor_enabled", "set_agent_cursor_motion", "set_agent_cursor_theme",
    "get_agent_cursor_state",
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

  it("detects cursor capabilities and initializes the overlay only once per live session", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commandNames = [...requiredCommandNames, "get_desktop_state", ...cursorCommandNames];
    let enabled = false;
    let theme = "cua.default";
    let reducedMotion = "auto";
    let motion: Record<string, number> = {};
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
            params?: Record<string, number | string> & { theme_id?: string; reduced_motion?: string };
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
      if (command === "set_agent_cursor_theme" && body.params?.theme_id) {
        theme = body.params.theme_id;
        reducedMotion = body.params.reduced_motion ?? reducedMotion;
      }
      if (command === "set_agent_cursor_motion") {
        motion = Object.fromEntries(
          Object.entries(body.params ?? {}).filter((entry): entry is [string, number] => (
            typeof entry[1] === "number"
          )),
        );
      }
      if (command === "set_agent_cursor_enabled") enabled = true;
      if (command === "get_agent_cursor_state") {
        return new Response(
          `data: ${JSON.stringify({
            success: true,
            session: "computer-server-1",
            enabled,
            theme: { id: theme, reduced_motion: reducedMotion },
            motion,
            visual_state: { resolved_action: "idle", phase: "loop" },
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
        session: "computer-server-1",
        theme: "dev.autopr.cursor.neon",
        reducedMotion: "off",
        motion: recordingMotion,
        visualState: { resolved_action: "idle", phase: "loop" },
      },
    });
    await expect(client.ensureReady()).resolves.toMatchObject({
      cursor: { available: true, enabled: true },
    });
    expect(commands.filter((command) => command === "set_agent_cursor_enabled")).toHaveLength(1);
    expect(commands.filter((command) => command === "set_agent_cursor_theme")).toHaveLength(1);
    expect(commands.filter((command) => command === "set_agent_cursor_motion")).toHaveLength(1);
  });

  it("reinitializes the cursor when a restarted server reports a fresh disabled session", async () => {
    const getSignedPreviewUrl = vi.fn(async () => ({ url: "https://cua.test/token/" }));
    const commandNames = [...requiredCommandNames, "get_desktop_state", ...cursorCommandNames];
    let enabled = false;
    let theme = "cua.default";
    let reducedMotion = "auto";
    let motion: Record<string, number> = {};
    let enableCalls = 0;
    let themeCalls = 0;
    let motionCalls = 0;
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
            params?: Record<string, number | string> & { theme_id?: string; reduced_motion?: string };
          }
        : {};
      if (body.command === "version") {
        return new Response('data: {"success":true,"package":"0.3.42"}\n\n');
      }
      if (body.command === "get_screen_size") {
        return new Response('data: {"success":true,"size":{"width":1920,"height":1080}}\n\n');
      }
      if (body.command === "set_agent_cursor_enabled") {
        enabled = true;
        enableCalls += 1;
      }
      if (body.command === "set_agent_cursor_theme" && body.params?.theme_id) {
        theme = body.params.theme_id;
        reducedMotion = body.params.reduced_motion ?? reducedMotion;
        themeCalls += 1;
      }
      if (body.command === "set_agent_cursor_motion") {
        motion = Object.fromEntries(
          Object.entries(body.params ?? {}).filter((entry): entry is [string, number] => (
            typeof entry[1] === "number"
          )),
        );
        motionCalls += 1;
      }
      if (body.command === "get_agent_cursor_state") {
        return new Response(
          `data: ${JSON.stringify({
            success: true,
            session: `generation-${enableCalls}`,
            enabled,
            theme: { id: theme, reduced_motion: reducedMotion },
            motion,
          })}\n\n`,
        );
      }
      return new Response('data: {"success":true}\n\n');
    }));

    const client = new CuaComputerClient({ getSignedPreviewUrl } as unknown as DaytonaSandbox, {});
    await client.ensureReady();
    enabled = false;
    theme = "cua.default";
    reducedMotion = "auto";
    motion = {};
    await client.ensureReady();
    expect(enableCalls).toBe(2);
    expect(themeCalls).toBe(2);
    expect(motionCalls).toBe(2);
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

    const client = new CuaComputerClient({ getSignedPreviewUrl } as unknown as DaytonaSandbox, {});
    await expect(client.ensureReady()).resolves.toMatchObject({
      backend: "native",
      cursor: {
        available: false,
        enabled: false,
        reason: expect.stringContaining("native computer use and Daytona recording remain active"),
      },
    });
    expect(commands).not.toContain("set_agent_cursor_enabled");
  });
});
