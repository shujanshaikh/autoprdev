export const DESKTOP_CONNECTION_OPEN_TIMEOUT_MS = 15_000;
export const DESKTOP_RECOVERY_CONFIRMATION_TIMEOUT_MS = 5_000;
export const DESKTOP_CONNECTION_RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;

export type DesktopRecoveryReason = "credentials" | "stream";

export type DesktopConnectionState =
  | { state: "idle" }
  | { state: "connecting"; phase: "opening" | "reconnecting" }
  | { state: "connected" }
  | { state: "error"; error: string };

type DesktopRecoveryMachineOptions = {
  recover?: (reason: DesktopRecoveryReason) => boolean | void | Promise<boolean | void>;
  onStateChange: (state: DesktopConnectionState) => void;
  onOpeningTimeout?: () => void;
  openingTimeoutMs?: number;
  confirmationTimeoutMs?: number;
  retryDelaysMs?: readonly number[];
};

/** Owns desktop recovery timing so the RFB adapter only translates transport events. */
export function createDesktopRecoveryMachine({
  recover,
  onStateChange,
  onOpeningTimeout,
  openingTimeoutMs = DESKTOP_CONNECTION_OPEN_TIMEOUT_MS,
  confirmationTimeoutMs = DESKTOP_RECOVERY_CONFIRMATION_TIMEOUT_MS,
  retryDelaysMs = DESKTOP_CONNECTION_RETRY_DELAYS_MS,
}: DesktopRecoveryMachineOptions) {
  let state: DesktopConnectionState = { state: "idle" };
  let disposed = false;
  let recoveryAttempt = 0;
  let recoveryPending = false;
  let operation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const transition = (next: DesktopConnectionState) => {
    if (disposed) return;
    state = next;
    onStateChange(next);
  };
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const retryDelay = (attempt: number) => retryDelaysMs[
    Math.min(attempt, retryDelaysMs.length - 1)
  ] ?? 0;

  const requestRecovery = (reason: DesktopRecoveryReason) => {
    if (disposed || recoveryPending) return;
    clearTimer();

    if (!recover) {
      transition({
        state: "error",
        error: "The desktop stream ended and no recovery handler is available.",
      });
      return;
    }

    recoveryPending = true;
    const requestOperation = ++operation;
    transition({ state: "connecting", phase: "reconnecting" });

    void Promise.resolve()
      .then(() => recover(reason))
      .then((recovered) => {
        if (disposed || requestOperation !== operation) return;
        recoveryPending = false;

        if (recovered === false) {
          const delayMs = retryDelay(recoveryAttempt);
          recoveryAttempt += 1;
          timer = setTimeout(() => requestRecovery(reason), delayMs);
          return;
        }

        // The route owner disposes this machine when it publishes a new
        // revision. Ask again if that handoff never reaches the adapter.
        timer = setTimeout(() => requestRecovery(reason), confirmationTimeoutMs);
      })
      .catch(() => {
        if (disposed || requestOperation !== operation) return;
        recoveryPending = false;
        const delayMs = retryDelay(recoveryAttempt);
        recoveryAttempt += 1;
        timer = setTimeout(() => requestRecovery(reason), delayMs);
      });
  };

  return {
    getState: () => state,
    opening: () => {
      if (disposed) return;
      operation += 1;
      recoveryPending = false;
      recoveryAttempt = 0;
      clearTimer();
      transition({ state: "connecting", phase: "opening" });
      timer = setTimeout(() => {
        onOpeningTimeout?.();
        requestRecovery("stream");
      }, openingTimeoutMs);
    },
    connected: () => {
      if (disposed) return;
      operation += 1;
      recoveryPending = false;
      recoveryAttempt = 0;
      clearTimer();
      transition({ state: "connected" });
    },
    recover: requestRecovery,
    fail: (error: string) => {
      if (disposed) return;
      operation += 1;
      recoveryPending = false;
      clearTimer();
      transition({ state: "error", error });
    },
    dispose: () => {
      disposed = true;
      operation += 1;
      recoveryPending = false;
      clearTimer();
    },
  };
}
