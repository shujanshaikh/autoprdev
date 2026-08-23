import {
  COMPUTER_USE_PROCESS_NAMES,
  ensureComputerUseReady,
  recoverComputerUseStream,
  type ComputerUseProcessName,
} from "@autopr/config/computer-use-lifecycle";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

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

  it("coalesces concurrent readiness checks for one Daytona desktop", async () => {
    let releaseStatus: (() => void) | undefined;
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    const statuses = processStatuses();
    const computerUse = {
      getStatus: vi.fn(async () => {
        await statusGate;
        return { status: "active" };
      }),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      start: vi.fn(async () => undefined),
    };

    const first = ensureComputerUseReady(computerUse, { cacheMs: 0 });
    const second = ensureComputerUseReady(computerUse, { cacheMs: 0 });
    releaseStatus?.();
    await Promise.all([first, second]);

    expect(computerUse.getStatus).toHaveBeenCalledOnce();
    expect(computerUse.getProcessStatus).toHaveBeenCalledTimes(4);
  });

  it("reuses readiness across refreshed Daytona wrappers with one coordination key", async () => {
    const coordinationKey = {};
    const firstComputerUse = {
      getStatus: vi.fn(async () => ({ status: "active" })),
      start: vi.fn(async () => undefined),
    };
    const refreshedComputerUse = {
      getStatus: vi.fn(async () => ({ status: "active" })),
      start: vi.fn(async () => undefined),
    };

    await ensureComputerUseReady(firstComputerUse, { coordinationKey });
    await ensureComputerUseReady(refreshedComputerUse, { coordinationKey });

    expect(firstComputerUse.getStatus).toHaveBeenCalledOnce();
    expect(refreshedComputerUse.getStatus).not.toHaveBeenCalled();
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

  it("bounds status requests that never settle", async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => undefined);
    const computerUse = {
      getStatus: vi.fn(() => never),
      getProcessStatus: vi.fn(() => never),
      start: vi.fn(async () => undefined),
    };

    const readiness = ensureComputerUseReady(computerUse, {
      cacheMs: 0,
      pollIntervalMs: 0,
      timeoutMs: 25,
    });
    const rejected = expect(readiness).rejects.toThrow("Daytona desktop did not become ready");
    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();

    await rejected;
  });

  it("bounds diagnostics after readiness times out", async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => undefined);
    const statuses = processStatuses({ novnc: false });
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "partial" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      getProcessErrors: vi.fn(() => never),
      getProcessLogs: vi.fn(() => never),
      restartProcess: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
    };

    const readiness = ensureComputerUseReady(computerUse, {
      cacheMs: 0,
      pollIntervalMs: 0,
      timeoutMs: 0,
    });
    const rejected = expect(readiness).rejects.toThrow(
      /errors_error=.*timed out.*logs_error=.*timed out/i,
    );
    await vi.runAllTimersAsync();

    await rejected;
  });

  it("reattaches the VNC transport without restarting the desktop session", async () => {
    const statuses = processStatuses();
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "active" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      restartProcess: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
    };

    await recoverComputerUseStream(computerUse, { pollIntervalMs: 0, timeoutMs: 10 });

    expect(computerUse.restartProcess.mock.calls).toEqual([["x11vnc"], ["novnc"]]);
    expect(computerUse.start).not.toHaveBeenCalled();
  });

  it("coalesces concurrent VNC recovery requests", async () => {
    let releaseRestart: (() => void) | undefined;
    const restartGate = new Promise<void>((resolve) => {
      releaseRestart = resolve;
    });
    const statuses = processStatuses();
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "active" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      restartProcess: vi.fn(async (name: string) => {
        if (name === "x11vnc") await restartGate;
      }),
      start: vi.fn(async () => undefined),
    };

    const first = recoverComputerUseStream(computerUse, { pollIntervalMs: 0 });
    const second = recoverComputerUseStream(computerUse, { pollIntervalMs: 0 });
    releaseRestart?.();
    await Promise.all([first, second]);

    expect(computerUse.restartProcess.mock.calls).toEqual([["x11vnc"], ["novnc"]]);
  });

  it("waits for x11vnc before restarting noVNC and returning the stream", async () => {
    const statuses = processStatuses();
    const events: string[] = [];
    const probes = new Map([[5901, 0], [6080, 0]]);
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "active" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      restartProcess: vi.fn(async (name: string) => {
        events.push(`restart:${name}`);
      }),
      start: vi.fn(async () => undefined),
    };

    await recoverComputerUseStream(computerUse, {
      pollIntervalMs: 0,
      timeoutMs: 20,
      probePort: async (port) => {
        events.push(`probe:${port}`);
        const attempts = probes.get(port) ?? 0;
        probes.set(port, attempts + 1);
        return attempts > 0;
      },
    });

    expect(events).toEqual([
      "restart:x11vnc",
      "probe:5901",
      "probe:5901",
      "restart:novnc",
      "probe:6080",
      "probe:6080",
    ]);
  });

  it("does not restart noVNC when x11vnc never binds its socket", async () => {
    const statuses = processStatuses();
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "active" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: statuses.get(name as ComputerUseProcessName),
      })),
      getProcessErrors: vi.fn(async () => ({ errors: "caught signal: 11" })),
      restartProcess: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
    };

    await expect(recoverComputerUseStream(computerUse, {
      pollIntervalMs: 0,
      timeoutMs: 0,
      probePort: async () => false,
    })).rejects.toThrow(/x11vnc did not accept connections on port 5901.*caught signal: 11/);

    expect(computerUse.restartProcess).toHaveBeenCalledExactlyOnceWith("x11vnc");
  });

  it("requires explicit transport process health after stream recovery", async () => {
    const computerUse = {
      getStatus: vi.fn(async () => ({ status: "active" })),
      getProcessStatus: vi.fn(async (name: string) => ({
        processName: name,
        running: name === "x11vnc" || name === "novnc" ? undefined : true,
        status: name === "x11vnc" || name === "novnc" ? "starting" : "running",
      })),
      restartProcess: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
    };

    await expect(recoverComputerUseStream(computerUse, {
      pollIntervalMs: 0,
      timeoutMs: 0,
    })).rejects.toThrow(/x11vnc.*status=starting.*novnc.*status=starting/);
  });
});
