import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSandboxContext: vi.fn(),
  ensureReady: vi.fn(),
  inspect: vi.fn(),
  command: vi.fn(),
}));

vi.mock("../sandbox", () => ({ getSandboxContext: mocks.getSandboxContext }));
vi.mock("./cua-client", () => ({
  CuaComputerClient: class {
    ensureReady = mocks.ensureReady;
    inspect = mocks.inspect;
    command = mocks.command;
  },
}));

import { createCuaComputerTool } from "./computer";
import { safeParse } from "../test/schema";

describe("CUA computer tool input", () => {
  const computer = createCuaComputerTool({ cacheKey: "computer-schema" });

  it("accepts absolute HTTP(S) preview URLs", () => {
    expect(safeParse(computer.inputSchema, {
      actions: [{ type: "open_url", url: "http://localhost:3000/project/1" }],
    }).success).toBe(true);
    expect(safeParse(computer.inputSchema, {
      action: "open_url",
      url: "https://example.com",
    }).success).toBe(true);
  });

  it("rejects script, file, and malformed browser targets", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "localhost:3000"]) {
      expect(safeParse(computer.inputSchema, {
        actions: [{ type: "open_url", url }],
      }).success).toBe(false);
    }
  });

  it("uses CUA-supported screenshot formats", () => {
    expect(safeParse(computer.inputSchema, {
      actions: [{ type: "screenshot", format: "jpeg", quality: 85 }],
    }).success).toBe(true);
    expect(safeParse(computer.inputSchema, {
      actions: [{ type: "screenshot", format: "webp" }],
    }).success).toBe(false);
  });

  it("accepts standard computer-use drag, scroll-delta, and key-array shapes", () => {
    expect(safeParse(computer.inputSchema, {
      actions: [
        { type: "drag", path: [{ x: 10, y: 20 }, { x: 30, y: 40 }] },
        { type: "scroll", x: 30, y: 40, scroll_x: 0, scroll_y: 350 },
        { type: "keypress", keys: ["CTRL", "L"] },
      ],
    }).success).toBe(true);
  });
});

describe("CUA computer tool timeout quarantine", () => {
  const getStatus = vi.fn(async () => ({ status: "active" }));
  const stopRecording = vi.fn(async () => ({
    id: "recording-1",
    status: "completed",
  }));
  const startRecording = vi.fn(async () => ({
    id: "recording-2",
    status: "started",
  }));
  const computerUse = {
    getStatus,
    recording: { start: startRecording, stop: stopRecording },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureReady.mockResolvedValue({
      status: "ok",
      os_type: "linux",
      backend: "cua-driver",
      cursor: {
        available: true,
        enabled: false,
        theme: "cua.default",
        capabilities: [],
      },
    });
    mocks.inspect.mockResolvedValue({ status: "ok", os_type: "linux" });
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: { id: "sandbox-computer", computerUse },
      workDir: "/workspace/repo",
    });
  });

  it("does not overlap a retry with an action that outlived its timeout", async () => {
    vi.useFakeTimers();
    try {
      let finishClick: (() => void) | undefined;
      mocks.command.mockImplementation((command: string) => {
        if (command === "get_screen_size") {
          return Promise.resolve({ success: true, size: { width: 1920, height: 1080 } });
        }
        if (command === "left_click") {
          return new Promise<void>((resolve) => {
            finishClick = resolve;
          });
        }
        return Promise.resolve({ success: true });
      });
      const computer = createCuaComputerTool({ cacheKey: "computer-timeout" });
      if (!computer.execute) throw new Error("computer tool is not executable");

      const timedOut = computer.execute(
        { actions: [{ type: "click", x: 10, y: 20 }] },
        { toolCallId: "computer-1", messages: [] },
      );
      const timedOutAssertion = expect(timedOut).rejects.toThrow(
        "Timed out running CUA computer action click",
      );
      await vi.advanceTimersByTimeAsync(120_000);
      await timedOutAssertion;

      const retry = computer.execute(
        { actions: [{ type: "status" }] },
        { toolCallId: "computer-2", messages: [] },
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(getStatus).toHaveBeenCalledTimes(1);

      finishClick?.();
      await vi.runAllTimersAsync();
      await expect(retry).resolves.toBeDefined();
      expect(getStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can stop a Daytona recording without starting the desktop or CUA", async () => {
    const computer = createCuaComputerTool({ cacheKey: "computer-recording-stop" });
    if (!computer.execute) throw new Error("computer tool is not executable");

    await expect(computer.execute(
      {
        actions: [{
          type: "stop_recording",
          recordingId: "recording-1",
          title: "CUA migration demo",
        }],
      },
      { toolCallId: "computer-recording", messages: [] },
    )).resolves.toBeDefined();

    expect(stopRecording).toHaveBeenCalledWith("recording-1");
    expect(getStatus).not.toHaveBeenCalled();
    expect(mocks.ensureReady).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("normalizes the desktop pointer before starting a Daytona recording", async () => {
    const computer = createCuaComputerTool(
      { cacheKey: "computer-recording-start" },
      { recordingEnabled: true },
    );
    if (!computer.execute) throw new Error("computer tool is not executable");

    await computer.execute(
      { actions: [{ type: "start_recording", title: "Visible cursor demo" }] },
      { toolCallId: "computer-recording-start", messages: [] },
    );

    expect(startRecording).toHaveBeenCalledWith("Visible cursor demo");
    expect(mocks.ensureReady).toHaveBeenCalledTimes(1);
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.ensureReady.mock.invocationCallOrder[0]).toBeLessThan(
      startRecording.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("blocks starting a recording when demo mode is disabled without touching the sandbox", async () => {
    const computer = createCuaComputerTool(
      { cacheKey: "computer-recording-disabled" },
      { recordingEnabled: false },
    );
    if (!computer.execute) throw new Error("computer tool is not executable");

    await expect(computer.execute(
      { actions: [{ type: "start_recording", title: "Unapproved demo" }] },
      { toolCallId: "computer-recording-disabled", messages: [] },
    )).rejects.toThrow("Demo recording is disabled for this thread");

    expect(mocks.getSandboxContext).not.toHaveBeenCalled();
    expect(startRecording).not.toHaveBeenCalled();
    expect(mocks.ensureReady).not.toHaveBeenCalled();
  });

  it("keeps movement, clicks, drag, and scroll positioning on the CUA action path", async () => {
    mocks.command.mockImplementation(async (command: string) => {
      if (command === "screenshot") {
        return { success: true, image_data: "AA==", format: "jpeg" };
      }
      if (command === "get_screen_size") {
        return { success: true, size: { width: 1920, height: 1080 } };
      }
      if (command === "get_cursor_position") {
        return { success: true, position: { x: 60, y: 70 } };
      }
      return { success: true };
    });
    const computer = createCuaComputerTool(
      { cacheKey: "computer-cursor-actions" },
      { recordingEnabled: false },
    );
    if (!computer.execute) throw new Error("computer tool is not executable");

    await computer.execute({
      actions: [
        { type: "move", x: 10, y: 20 },
        { type: "click", x: 20, y: 30 },
        { type: "click", x: 30, y: 40, button: "right" },
        { type: "double_click", x: 40, y: 50 },
        { type: "drag", startX: 40, startY: 50, endX: 60, endY: 70 },
        { type: "scroll", x: 60, y: 70, direction: "down", amount: 3 },
      ],
    }, { toolCallId: "computer-cursor-actions", messages: [] });

    const actionCalls = mocks.command.mock.calls.filter(
      ([command]) => !["screenshot", "get_screen_size", "get_cursor_position"].includes(command),
    );
    expect(actionCalls).toEqual([
      ["move_cursor", { x: 10, y: 20 }],
      ["left_click", { x: 20, y: 30 }],
      ["right_click", { x: 30, y: 40 }],
      ["double_click", { x: 40, y: 50 }],
      ["drag", { path: [[40, 50], [60, 70]], button: "left", duration: 0.5 }],
      ["move_cursor", { x: 60, y: 70 }],
      ["scroll_direction", { direction: "down", clicks: 3 }],
    ]);
  });

  it("rejects coordinates outside the current screenshot before sending input", async () => {
    mocks.command.mockImplementation(async (command: string) => {
      if (command === "get_screen_size") {
        return { success: true, size: { width: 100, height: 80 } };
      }
      return { success: true };
    });
    const computer = createCuaComputerTool({ cacheKey: "computer-coordinate-bounds" });
    if (!computer.execute) throw new Error("computer tool is not executable");

    await expect(computer.execute(
      { actions: [{ type: "click", x: 100, y: 20 }] },
      { toolCallId: "computer-coordinate-bounds", messages: [] },
    )).rejects.toThrow("outside the 100x80 screenshot");

    expect(mocks.command).not.toHaveBeenCalledWith("left_click", expect.anything());
  });

  it("normalizes standard computer-use actions onto the CUA command protocol", async () => {
    mocks.command.mockImplementation(async (command: string) => {
      if (command === "get_screen_size") {
        return { success: true, size: { width: 1920, height: 1080 } };
      }
      if (command === "screenshot") {
        return { success: true, image_data: "AA==", format: "png" };
      }
      return { success: true, effect: "confirmed", verified: true };
    });
    const computer = createCuaComputerTool({ cacheKey: "computer-standard-actions" });
    if (!computer.execute) throw new Error("computer tool is not executable");
    type ExecuteInput = Parameters<NonNullable<typeof computer.execute>>[0];
    const input = (computer.inputSchema as { parse(value: unknown): ExecuteInput }).parse({
      actions: [
        { type: "drag", path: [[10, 20], [30, 40]] },
        { type: "scroll", x: 30, y: 40, scrollX: -250, scrollY: 0 },
        { type: "keypress", keys: ["CTRL", "L"] },
      ],
    });

    await computer.execute(input, { toolCallId: "computer-standard-actions", messages: [] });

    expect(mocks.command).toHaveBeenCalledWith("drag", {
      path: [[10, 20], [30, 40]],
      button: "left",
      duration: 0.5,
    });
    expect(mocks.command).toHaveBeenCalledWith("scroll_direction", {
      direction: "left",
      clicks: 3,
    });
    expect(mocks.command).toHaveBeenCalledWith("hotkey", { keys: ["ctrl", "l"] });
  });

  it("pauses an uncertain batch and returns a lossless verification screenshot", async () => {
    mocks.command.mockImplementation(async (command: string, params?: Record<string, unknown>) => {
      if (command === "get_screen_size") {
        return { success: true, size: { width: 1920, height: 1080 } };
      }
      if (command === "left_click") {
        return { success: true, effect: "suspected_noop", verified: false };
      }
      if (command === "screenshot") {
        expect(params).toEqual({ format: "png", quality: 85 });
        return { success: true, image_data: "AA==", format: "png" };
      }
      if (command === "get_cursor_position") {
        return { success: true, position: { x: 10, y: 20 } };
      }
      return { success: true };
    });
    const computer = createCuaComputerTool({ cacheKey: "computer-uncertain-batch" });
    if (!computer.execute) throw new Error("computer tool is not executable");

    const result = await computer.execute(
      {
        actions: [
          { type: "click", x: 10, y: 20 },
          { type: "type", text: "must not be typed" },
        ],
      },
      { toolCallId: "computer-uncertain-batch", messages: [] },
    );

    expect(mocks.command).not.toHaveBeenCalledWith("type_text", expect.anything());
    expect(JSON.stringify(result)).toContain("Batch paused");
    expect(mocks.command).toHaveBeenCalledWith("screenshot", { format: "png", quality: 85 });
  });

  it("paces CUA typing when the caller requests a per-key delay", async () => {
    vi.useFakeTimers();
    try {
      mocks.command.mockImplementation(async (command: string) => {
        if (command === "screenshot") {
          return { success: true, image_data: "AA==", format: "jpeg" };
        }
        return { success: true };
      });
      const computer = createCuaComputerTool({ cacheKey: "computer-paced-typing" });
      if (!computer.execute) throw new Error("computer tool is not executable");

      const execution = computer.execute(
        { actions: [{ type: "type", text: "ab", delayMs: 25 }] },
        { toolCallId: "computer-paced-typing", messages: [] },
      );
      await vi.advanceTimersByTimeAsync(0);

      const typingCalls = () => mocks.command.mock.calls.filter(
        ([command]) => command === "type_text",
      );
      expect(typingCalls()).toEqual([["type_text", { text: "a" }]]);

      await vi.advanceTimersByTimeAsync(24);
      expect(typingCalls()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await execution;
      expect(typingCalls()).toEqual([
        ["type_text", { text: "a" }],
        ["type_text", { text: "b" }],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
