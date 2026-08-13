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
});

describe("CUA computer tool timeout quarantine", () => {
  const getStatus = vi.fn(async () => ({ status: "active" }));
  const stopRecording = vi.fn(async () => ({
    id: "recording-1",
    status: "completed",
  }));
  const computerUse = {
    getStatus,
    recording: { stop: stopRecording },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureReady.mockResolvedValue(undefined);
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
});
