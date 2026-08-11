import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSandboxContext: vi.fn(),
}));

vi.mock("../sandbox", () => ({ getSandboxContext: mocks.getSandboxContext }));

import { createDaytonaComputerTool } from "./computer";
import { safeParse } from "../test/schema";

describe("Daytona computer tool input", () => {
  const computer = createDaytonaComputerTool({ cacheKey: "computer-schema" });

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
});

describe("Daytona computer tool timeout quarantine", () => {
  const getStatus = vi.fn(async () => ({ status: "active" }));
  const click = vi.fn();
  const computerUse = {
    getStatus,
    mouse: { click },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSandboxContext.mockResolvedValue({
      sandbox: { id: "sandbox-computer", computerUse },
      workDir: "/workspace/repo",
    });
  });

  it("does not overlap a retry with an action that outlived its timeout", async () => {
    vi.useFakeTimers();
    try {
      let finishClick: (() => void) | undefined;
      click.mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishClick = resolve;
      }));
      const computer = createDaytonaComputerTool({ cacheKey: "computer-timeout" });
      if (!computer.execute) throw new Error("computer tool is not executable");

      const timedOut = computer.execute(
        { actions: [{ type: "click", x: 10, y: 20 }] },
        { toolCallId: "computer-1", messages: [] },
      );
      const timedOutAssertion = expect(timedOut).rejects.toThrow(
        "Timed out running Daytona computer action click",
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
});
