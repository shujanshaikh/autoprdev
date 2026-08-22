import {
  COMPUTER_USE_PROCESS_NAMES,
  ensureComputerUseReady,
  type ComputerUseProcessName,
} from "@autopr/config/computer-use-lifecycle";
import { describe, expect, it, vi } from "vitest";

function processStatuses(initial: Partial<Record<ComputerUseProcessName, boolean>> = {}) {
  return new Map<ComputerUseProcessName, boolean>(
    COMPUTER_USE_PROCESS_NAMES.map((name) => [name, initial[name] ?? true]),
  );
}

describe("Daytona computer-use lifecycle", () => {
  it("accepts partial aggregate status when every core desktop process is running", async () => {
    const statuses = processStatuses();
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "partial" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      restartProcess: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };

    await ensureComputerUseReady(computerUse, { cacheMs: 0, timeoutMs: 0 });

    expect(computerUse.start).not.toHaveBeenCalled();
    expect(computerUse.restartProcess).not.toHaveBeenCalled();
    expect(computerUse.stop).not.toHaveBeenCalled();
  });

  it("repairs a stopped process even when Daytona still reports the desktop as active", async () => {
    const statuses = processStatuses({ novnc: false });
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "active" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      restartProcess: vi.fn(async (name: string) => {
        statuses.set(name as ComputerUseProcessName, true);
      }),
      start: vi.fn(async () => undefined),
    };

    await ensureComputerUseReady(computerUse, { cacheMs: 0, pollIntervalMs: 0, timeoutMs: 10 });

    expect(computerUse.restartProcess).toHaveBeenCalledExactlyOnceWith("novnc");
    expect(computerUse.start).not.toHaveBeenCalled();
  });

  it("restarts only the core process Daytona reports as stopped", async () => {
    const statuses = processStatuses({ x11vnc: false });
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "partial" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      restartProcess: vi.fn(async (name: string) => {
        statuses.set(name as ComputerUseProcessName, true);
      }),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };

    await ensureComputerUseReady(computerUse, { cacheMs: 0, pollIntervalMs: 0, timeoutMs: 10 });

    expect(computerUse.restartProcess).toHaveBeenCalledExactlyOnceWith("x11vnc");
    expect(computerUse.start).not.toHaveBeenCalled();
    expect(computerUse.stop).not.toHaveBeenCalled();
  });

  it("starts an inactive desktop without stopping it first", async () => {
    let active = false;
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: active ? "active" : "inactive" })),
      start: vi.fn(async () => {
        active = true;
      }),
      stop: vi.fn(async () => undefined),
    };

    await ensureComputerUseReady(computerUse, { cacheMs: 0, pollIntervalMs: 0, timeoutMs: 10 });

    expect(computerUse.start).toHaveBeenCalledOnce();
    expect(computerUse.stop).not.toHaveBeenCalled();
  });

  it("fails with process diagnostics instead of resetting the entire desktop", async () => {
    const statuses = processStatuses({ novnc: false });
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "partial" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      getProcessErrors: vi.fn(async () => ({ errors: "still unavailable" })),
      restartProcess: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };

    await expect(ensureComputerUseReady(computerUse, {
      cacheMs: 0,
      pollIntervalMs: 0,
      timeoutMs: 0,
    })).rejects.toThrow(/novnc running=false.*still unavailable/);

    expect(computerUse.restartProcess).toHaveBeenCalledExactlyOnceWith("novnc");
    expect(computerUse.stop).not.toHaveBeenCalled();
  });
});
