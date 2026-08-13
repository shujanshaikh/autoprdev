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
    const commandNames = [
      "version", "open", "get_current_window_id", "get_window_name", "get_window_size",
      "get_window_position", "move_cursor", "left_click", "right_click", "mouse_down",
      "mouse_up", "double_click", "drag", "scroll_direction", "type_text", "press_key",
      "hotkey", "screenshot", "get_cursor_position", "get_screen_size",
    ];
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
    });
    expect(getSignedPreviewUrl).toHaveBeenCalledTimes(1);
  });
});
