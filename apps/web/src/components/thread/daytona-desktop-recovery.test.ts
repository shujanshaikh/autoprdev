import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDesktopRecoveryMachine,
  type DesktopConnectionState,
} from "./daytona-desktop-recovery";

afterEach(() => {
  vi.useRealTimers();
});

describe("Daytona desktop recovery machine", () => {
  it("orders the opening timeout, failed-recovery backoff, and handoff watchdog", async () => {
    vi.useFakeTimers();
    const states: DesktopConnectionState[] = [];
    const recover = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const onOpeningTimeout = vi.fn();
    const recovery = createDesktopRecoveryMachine({
      recover,
      onOpeningTimeout,
      onStateChange: (state) => states.push(state),
    });

    recovery.opening();
    expect(states.at(-1)).toEqual({ state: "connecting", phase: "opening" });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(onOpeningTimeout).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledExactlyOnceWith("stream");
    expect(states.at(-1)).toEqual({ state: "connecting", phase: "reconnecting" });

    await vi.advanceTimersByTimeAsync(499);
    expect(recover).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(recover).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(recover).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(recover).toHaveBeenCalledTimes(3);

    recovery.dispose();
  });

  it("enters a terminal error when recovery has no owner", () => {
    const states: DesktopConnectionState[] = [];
    const recovery = createDesktopRecoveryMachine({
      onStateChange: (state) => states.push(state),
    });

    recovery.recover("stream");

    expect(recovery.getState()).toEqual({
      state: "error",
      error: "The desktop stream ended and no recovery handler is available.",
    });
    expect(states.at(-1)).toEqual(recovery.getState());
  });
});
