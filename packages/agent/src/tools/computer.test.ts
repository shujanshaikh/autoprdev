import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSandboxContext: vi.fn(),
  ensureReady: vi.fn(),
  inspect: vi.fn(),
  command: vi.fn(),
}));

import { createCuaComputerTool } from "./computer";
import { safeParse } from "../test/schema";

const dependencies = {
  getSandboxContext: mocks.getSandboxContext,
  createClient: () => ({
    ensureReady: mocks.ensureReady,
    inspect: mocks.inspect,
    command: mocks.command,
  }),
};

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
        enabled: true,
        theme: "dev.autopr.cursor.neon",
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
      mocks.command.mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishClick = resolve;
      }));
      const computer = createCuaComputerTool({ cacheKey: "computer-timeout" }, {}, dependencies);
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
    const computer = createCuaComputerTool({ cacheKey: "computer-recording-stop" }, {}, dependencies);
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

  it("initializes the visible CUA cursor before starting a Daytona recording", async () => {
    const computer = createCuaComputerTool({ cacheKey: "computer-recording-start" }, {}, dependencies);
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
    const computer = createCuaComputerTool({ cacheKey: "computer-cursor-actions" }, {}, dependencies);
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

  it("paces CUA typing when the caller requests a per-key delay", async () => {
    vi.useFakeTimers();
    try {
      mocks.command.mockImplementation(async (command: string) => {
        if (command === "screenshot") {
          return { success: true, image_data: "AA==", format: "jpeg" };
        }
        return { success: true };
      });
      const computer = createCuaComputerTool(
        { cacheKey: "computer-paced-typing" },
        {},
        dependencies,
      );
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
