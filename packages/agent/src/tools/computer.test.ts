import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSandboxContext: vi.fn(),
  ensureReady: vi.fn(),
  inspect: vi.fn(),
  command: vi.fn(),
  supports: vi.fn(),
  clientConstructions: 0,
}));

vi.mock("../sandbox", () => ({ getSandboxContext: mocks.getSandboxContext }));
vi.mock("./cua-client", () => ({
  CuaComputerClient: class {
    constructor() {
      mocks.clientConstructions += 1;
    }

    ensureReady = mocks.ensureReady;
    inspect = mocks.inspect;
    command = mocks.command;
    supports = mocks.supports;
  },
}));

import { createCuaComputerTool, COMPUTER_METADATA_PREFIX } from "./computer";
import { safeParse } from "../test/schema";

type ToolResult = {
  type: "content";
  value: Array<{ type: string; text?: string }>;
};

function metadata(result: unknown): Record<string, unknown> {
  const value = (result as ToolResult).value;
  const item = value.find((entry) => entry.text?.startsWith(COMPUTER_METADATA_PREFIX));
  if (!item?.text) throw new Error("computer metadata is missing");
  return JSON.parse(item.text.slice(COMPUTER_METADATA_PREFIX.length)) as Record<string, unknown>;
}

function observationId(result: unknown): string {
  const screenshot = metadata(result).screenshot as Record<string, unknown>;
  if (typeof screenshot.id !== "string") throw new Error("observation ID is missing");
  return screenshot.id;
}

describe("CUA computer tool input", () => {
  const computer = createCuaComputerTool({ cacheKey: "computer-schema" });

  it("exposes one strict CUA action instead of legacy batches", () => {
    expect(safeParse(computer.inputSchema, { type: "screenshot" }).success).toBe(true);
    expect(safeParse(computer.inputSchema, {
      actions: [{ type: "screenshot" }],
    }).success).toBe(false);
    expect(safeParse(computer.inputSchema, {
      type: "click",
      observationId: "obs-1-abcdef123456",
      x: 10,
      y: 20,
    }).success).toBe(true);
    expect(safeParse(computer.inputSchema, { type: "click", x: 10, y: 20 }).success).toBe(false);
  });

  it("accepts CUA crops, window zoom, full drag paths, and clipboard actions", () => {
    expect(safeParse(computer.inputSchema, {
      type: "screenshot",
      region: { x: 10, y: 20, width: 300, height: 200 },
    }).success).toBe(true);
    expect(safeParse(computer.inputSchema, { type: "screenshot", windowId: 42 }).success).toBe(true);
    expect(safeParse(computer.inputSchema, {
      type: "drag",
      observationId: "obs-1-abcdef123456",
      path: [{ x: 10, y: 20 }, { x: 20, y: 35 }, { x: 40, y: 50 }],
    }).success).toBe(true);
    expect(safeParse(computer.inputSchema, { type: "clipboard_write", text: "hello" }).success).toBe(true);
  });

  it("keeps browser targets and screenshot formats constrained", () => {
    expect(safeParse(computer.inputSchema, {
      type: "open_url",
      url: "http://localhost:3000/project/1",
    }).success).toBe(true);
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "localhost:3000"]) {
      expect(safeParse(computer.inputSchema, { type: "open_url", url }).success).toBe(false);
    }
    expect(safeParse(computer.inputSchema, { type: "screenshot", format: "webp" }).success).toBe(false);
  });
});

describe("CUA computer execution", () => {
  const getStatus = vi.fn(async () => ({ status: "active" }));
  const startRecording = vi.fn(async () => ({ id: "recording-1", status: "started" }));
  const stopRecording = vi.fn(async () => ({ id: "recording-1", status: "completed" }));
  const listRecordings = vi.fn(async () => ({ recordings: [] }));
  const getRecording = vi.fn(async () => ({ id: "recording-1", status: "completed" }));
  let sandbox: {
    id: string;
    computerUse: {
      getStatus: typeof getStatus;
      recording: {
        start: typeof startRecording;
        stop: typeof stopRecording;
        list: typeof listRecordings;
        get: typeof getRecording;
      };
    };
  };
  let imageData: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.clientConstructions = 0;
    imageData = (await sharp({
      create: { width: 100, height: 80, channels: 3, background: "#111111" },
    }).png().toBuffer()).toString("base64");
    sandbox = {
      id: `sandbox-${Math.random()}`,
      computerUse: {
        getStatus,
        recording: {
          start: startRecording,
          stop: stopRecording,
          list: listRecordings,
          get: getRecording,
        },
      },
    };
    mocks.getSandboxContext.mockResolvedValue({ sandbox, workDir: "/workspace/repo" });
    mocks.ensureReady.mockResolvedValue({
      status: "ok",
      os_type: "linux",
      backend: "cua-driver",
      cursor: { available: true, enabled: true, capabilities: [] },
    });
    mocks.inspect.mockResolvedValue({ status: "ok", os_type: "linux" });
    mocks.supports.mockImplementation((command: string) => command === "get_desktop_state");
    mocks.command.mockImplementation(async (command: string) => {
      if (command === "get_desktop_state") {
        return {
          success: true,
          image_data: imageData,
          screen_width: 100,
          screen_height: 80,
          screenshot_width: 100,
          screenshot_height: 80,
        };
      }
      if (command === "get_cursor_position") {
        return { success: true, position: { x: 20, y: 30 } };
      }
      if (command === "get_screen_size") {
        return { success: true, size: { width: 100, height: 80 } };
      }
      return { success: true, effect: "confirmed" };
    });
  });

  it("reuses one CUA client and captures atomic desktop state", async () => {
    const computer = createCuaComputerTool({ cacheKey: "persistent-client" });
    if (!computer.execute) throw new Error("computer tool is not executable");

    const first = await computer.execute({ type: "screenshot" }, { toolCallId: "one", messages: [] });
    const second = await computer.execute({ type: "screenshot" }, { toolCallId: "two", messages: [] });

    expect(mocks.clientConstructions).toBe(1);
    expect(mocks.command.mock.calls.filter(([command]) => command === "get_desktop_state")).toHaveLength(2);
    expect(mocks.command).not.toHaveBeenCalledWith("screenshot", expect.anything());
    expect(observationId(first)).not.toBe(observationId(second));
    expect(metadata(second)).toMatchObject({
      screenshot: { captureKind: "desktop_state" },
    });
  });

  it("rejects stale coordinates and translates cropped coordinates back to the screen", async () => {
    const computer = createCuaComputerTool({ cacheKey: "observation-coordinates" });
    if (!computer.execute) throw new Error("computer tool is not executable");
    const cropped = await computer.execute(
      { type: "screenshot", region: { x: 10, y: 20, width: 40, height: 30 } },
      { toolCallId: "crop", messages: [] },
    );
    const id = observationId(cropped);

    await expect(computer.execute(
      { type: "click", observationId: "obs-0-stale000000", x: 5, y: 6 },
      { toolCallId: "stale", messages: [] },
    )).rejects.toThrow("Stale CUA observation");

    await computer.execute(
      { type: "click", observationId: id, x: 5, y: 6 },
      { toolCallId: "click", messages: [] },
    );
    expect(mocks.command).toHaveBeenCalledWith("left_click", { x: 15, y: 26 });
  });

  it("preserves every drag point and scales screenshot coordinates", async () => {
    mocks.command.mockImplementation(async (command: string) => {
      if (command === "get_desktop_state") {
        return {
          success: true,
          image_data: imageData,
          screen_width: 200,
          screen_height: 160,
          screenshot_width: 100,
          screenshot_height: 80,
        };
      }
      if (command === "get_cursor_position") return { success: true, position: { x: 0, y: 0 } };
      return { success: true, effect: "confirmed" };
    });
    const computer = createCuaComputerTool({ cacheKey: "drag-scale" });
    if (!computer.execute) throw new Error("computer tool is not executable");
    const shot = await computer.execute({ type: "screenshot" }, { toolCallId: "shot", messages: [] });
    await computer.execute({
      type: "drag",
      observationId: observationId(shot),
      path: [{ x: 1, y: 2 }, { x: 10, y: 20 }, { x: 30, y: 40 }],
      durationMs: 900,
    }, { toolCallId: "drag", messages: [] });
    expect(mocks.command).toHaveBeenCalledWith("drag", {
      path: [[2, 4], [20, 40], [60, 80]],
      button: "left",
      duration: 0.9,
    });
  });

  it("captures exactly one CUA frame after an action", async () => {
    const computer = createCuaComputerTool({ cacheKey: "single-frame" });
    if (!computer.execute) throw new Error("computer tool is not executable");
    const shot = await computer.execute({ type: "screenshot" }, { toolCallId: "shot", messages: [] });
    mocks.command.mockClear();
    const result = await computer.execute({
      type: "click",
      observationId: observationId(shot),
      x: 10,
      y: 10,
    }, { toolCallId: "click", messages: [] });
    expect(mocks.command.mock.calls.filter(([command]) => command === "get_desktop_state")).toHaveLength(1);
    expect(metadata(result)).toMatchObject({ screenshot: { captureKind: "desktop_state" } });
  });

  it("uses CUA window, clipboard, and single-request text commands", async () => {
    mocks.command.mockImplementation(async (command: string) => {
      if (command === "get_desktop_state") {
        return {
          success: true,
          image_data: imageData,
          screen_width: 100,
          screen_height: 80,
          screenshot_width: 100,
          screenshot_height: 80,
        };
      }
      if (command === "get_cursor_position") return { success: true, position: { x: 0, y: 0 } };
      if (command === "get_application_windows") return { success: true, windows: [7] };
      if (command === "get_window_name") return { success: true, name: "Chrome" };
      if (command === "get_window_size") return { success: true, width: 60, height: 50 };
      if (command === "get_window_position") return { success: true, x: 10, y: 20 };
      if (command === "copy_to_clipboard") return { success: true, content: "copied" };
      return { success: true, effect: "confirmed" };
    });
    const computer = createCuaComputerTool({ cacheKey: "expanded-cua" });
    if (!computer.execute) throw new Error("computer tool is not executable");
    const windows = await computer.execute({ type: "windows", app: "Chrome" }, { toolCallId: "windows", messages: [] });
    expect(metadata(windows)).toMatchObject({ windows: [{ id: 7, name: "Chrome" }] });
    const zoomed = await computer.execute({ type: "screenshot", windowId: 7 }, { toolCallId: "zoom", messages: [] });
    expect(metadata(zoomed)).toMatchObject({
      screenshot: { origin: { x: 10, y: 20 }, width: 60, height: 50 },
    });
    const clipboard = await computer.execute({ type: "clipboard_read" }, { toolCallId: "clipboard", messages: [] });
    expect(metadata(clipboard)).toMatchObject({ clipboard: "copied" });
    await computer.execute(
      { type: "clipboard_write", text: "replacement" },
      { toolCallId: "clipboard-write", messages: [] },
    );
    expect(mocks.command).toHaveBeenCalledWith("set_clipboard", { text: "replacement" });

    await computer.execute({ type: "type", text: "hello" }, { toolCallId: "type", messages: [] });
    expect(mocks.command.mock.calls.filter(([command]) => command === "type_text")).toEqual([
      ["type_text", { text: "hello" }],
    ]);
  });

  it("returns per-action CUA trajectory diagnostics", async () => {
    const computer = createCuaComputerTool({ cacheKey: "trajectory" });
    if (!computer.execute) throw new Error("computer tool is not executable");
    const shot = await computer.execute({ type: "screenshot" }, { toolCallId: "shot", messages: [] });
    mocks.command.mockImplementation(async (command: string) => {
      if (command === "get_desktop_state") {
        return {
          success: true,
          image_data: imageData,
          screen_width: 100,
          screen_height: 80,
          screenshot_width: 100,
          screenshot_height: 80,
        };
      }
      if (command === "get_cursor_position") return { success: true, position: { x: 0, y: 0 } };
      if (command === "left_click") {
        return { success: true, effect: "confirmed", transport_retries: 1 };
      }
      return { success: true };
    });
    const result = await computer.execute({
      type: "click",
      observationId: observationId(shot),
      x: 10,
      y: 10,
    }, { toolCallId: "click", messages: [] });
    expect(metadata(result)).toMatchObject({
      trajectory: { status: "completed", effect: "confirmed", transportRetries: 1 },
      recentTrajectory: expect.arrayContaining([
        expect.objectContaining({ action: "screenshot(full)" }),
        expect.objectContaining({ action: "click(10,10,left)" }),
      ]),
    });
  });

  it("keeps recording permission checks outside the sandbox", async () => {
    const computer = createCuaComputerTool({ cacheKey: "recording-disabled" }, { recordingEnabled: false });
    if (!computer.execute) throw new Error("computer tool is not executable");
    await expect(computer.execute(
      { type: "start_recording", title: "Unapproved demo" },
      { toolCallId: "recording", messages: [] },
    )).rejects.toThrow("Demo recording is disabled for this thread");
    expect(mocks.getSandboxContext).not.toHaveBeenCalled();
  });

  it("does not overlap a retry with an action that outlived its timeout", async () => {
    vi.useFakeTimers();
    try {
      let finishType: (() => void) | undefined;
      mocks.command.mockImplementation((command: string) => {
        if (command === "type_text") {
          return new Promise((resolve) => {
            finishType = () => resolve({ success: true });
          });
        }
        return Promise.resolve({ success: true });
      });
      const computer = createCuaComputerTool({ cacheKey: "timeout-quarantine" });
      if (!computer.execute) throw new Error("computer tool is not executable");
      const timedOut = computer.execute({ type: "type", text: "x" }, { toolCallId: "type", messages: [] });
      const assertion = expect(timedOut).rejects.toThrow("Timed out running CUA computer action type");
      await vi.advanceTimersByTimeAsync(120_000);
      await assertion;

      const retry = computer.execute({ type: "status" }, { toolCallId: "status", messages: [] });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(getStatus).toHaveBeenCalledTimes(1);
      finishType?.();
      await vi.runAllTimersAsync();
      await retry;
      expect(getStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
