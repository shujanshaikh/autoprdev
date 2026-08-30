import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDaytonaTools: vi.fn(),
  loadSandboxProjectInstructions: vi.fn(),
  prepareDaytonaSandbox: vi.fn(),
}));

vi.mock("./tools", () => ({
  createDaytonaTools: mocks.createDaytonaTools,
}));

vi.mock("./project-instructions", () => ({
  loadSandboxProjectInstructions: mocks.loadSandboxProjectInstructions,
}));

vi.mock("./steps", () => ({
  prepareDaytonaSandbox: mocks.prepareDaytonaSandbox,
}));

import { CodingHarness, CodingHarnessBusyError, type CodingHarnessEvent } from "./harness";

describe("CodingHarness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareDaytonaSandbox.mockResolvedValue({
      sandboxId: "sandbox-1",
      sandboxName: "autopr-test",
      snapshot: "autopr-cua",
      workDir: "/workspace/repo",
    });
    mocks.createDaytonaTools.mockReturnValue({
      read: { description: "read" },
      bash: { description: "bash" },
      process: { description: "process" },
    });
    mocks.loadSandboxProjectInstructions.mockResolvedValue([
      { path: "/workspace/repo/AGENTS.md", content: "Use pnpm." },
    ]);
  });

  it("prepares once and exposes a deterministic run lifecycle", async () => {
    const harness = new CodingHarness({ cacheKey: "harness-test" });
    const events: CodingHarnessEvent[] = [];
    harness.on((event) => {
      events.push(event);
    });

    await expect(harness.run(async (context) => {
      expect(context.sandbox.workDir).toBe("/workspace/repo");
      expect(context.repositoryContext).toContain("Use pnpm.");
      return "complete";
    })).resolves.toBe("complete");

    expect(mocks.prepareDaytonaSandbox).toHaveBeenCalledOnce();
    expect(harness.getPhase()).toBe("idle");
    expect(events.map((event) => event.type)).toEqual([
      "phase_change",
      "sandbox_prepared",
      "phase_change",
      "phase_change",
      "run_start",
      "phase_change",
      "run_finish",
      "phase_change",
    ]);

    await harness.run(async () => undefined);
    expect(mocks.prepareDaytonaSandbox).toHaveBeenCalledOnce();
  });

  it("deduplicates selected tools and reports unavailable names", async () => {
    const harness = new CodingHarness({
      cacheKey: "harness-tools",
      selectedTools: [" read ", "missing", "read", "process", ""],
    });

    const context = await harness.prepare();

    expect(context.toolNames).toEqual(["read", "process"]);
    expect(context.unavailableSelectedTools).toEqual(["missing"]);
    expect(Object.keys(context.tools)).toEqual(["read", "process"]);
  });

  it("passes the configured sub-agent runner into the tool set", async () => {
    const run = vi.fn();
    const harness = new CodingHarness({
      cacheKey: "harness-sub-agent",
      subAgent: { run },
    });

    await harness.prepare();

    expect(mocks.createDaytonaTools).toHaveBeenCalledWith(
      expect.objectContaining({ cacheKey: "harness-sub-agent" }),
      expect.objectContaining({ subAgent: { run } }),
    );
  });

  it("returns to idle after preparation failure and can retry", async () => {
    const failure = new Error("sandbox unavailable");
    mocks.prepareDaytonaSandbox.mockRejectedValueOnce(failure);
    const harness = new CodingHarness({ cacheKey: "harness-retry" });
    const events: CodingHarnessEvent[] = [];
    harness.on((event) => {
      events.push(event);
    });

    await expect(harness.prepare()).rejects.toBe(failure);
    expect(harness.getPhase()).toBe("idle");
    expect(events.some((event) => event.type === "run_error" && event.error === failure)).toBe(true);

    await expect(harness.prepare()).resolves.toMatchObject({
      sandbox: { sandboxId: "sandbox-1" },
    });
    expect(mocks.prepareDaytonaSandbox).toHaveBeenCalledTimes(2);
  });

  it("isolates listener failures from the agent run", async () => {
    const listenerFailure = new Error("telemetry offline");
    const onListenerError = vi.fn();
    const harness = new CodingHarness({ cacheKey: "harness-listener", onListenerError });
    harness.on(() => {
      throw listenerFailure;
    });

    await expect(harness.run(async () => 42)).resolves.toBe(42);
    expect(onListenerError).toHaveBeenCalled();
    expect(onListenerError.mock.calls.some(([failure]) => failure.error === listenerFailure)).toBe(true);
    expect(harness.getPhase()).toBe("idle");
  });

  it("rejects overlapping runs without corrupting the active run", async () => {
    const harness = new CodingHarness({ cacheKey: "harness-busy" });
    let releaseRun!: () => void;
    const activeRun = harness.run(() => new Promise<void>((resolve) => {
      releaseRun = resolve;
    }));

    await vi.waitFor(() => expect(harness.getPhase()).toBe("running"));
    await expect(harness.run(async () => undefined)).rejects.toBeInstanceOf(CodingHarnessBusyError);
    expect(harness.getPhase()).toBe("running");

    releaseRun();
    await expect(activeRun).resolves.toBeUndefined();
    expect(harness.getPhase()).toBe("idle");
  });
});
