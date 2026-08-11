import type { ResolvedConfig } from "../config.ts";

function combineSignals(timeoutSignal: AbortSignal, callerSignal?: AbortSignal | null): AbortSignal {
  if (!callerSignal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([callerSignal, timeoutSignal]);
  }

  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  const onCallerAbort = () => abortFrom(callerSignal);
  const onTimeout = () => abortFrom(timeoutSignal);
  callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  controller.signal.addEventListener("abort", () => {
    callerSignal.removeEventListener("abort", onCallerAbort);
    timeoutSignal.removeEventListener("abort", onTimeout);
  }, { once: true });

  if (callerSignal.aborted) abortFrom(callerSignal);
  else if (timeoutSignal.aborted) abortFrom(timeoutSignal);
  return controller.signal;
}

/** Combines caller cancellation with the configured deadline for an outbound request. */
export function requestSignal(config: ResolvedConfig, callerSignal?: AbortSignal | null): AbortSignal {
  return combineSignals(AbortSignal.timeout(config.requestTimeoutMs), callerSignal);
}

/**
 * Creates a deadline that can be disarmed once response headers arrive.
 *
 * Streaming model responses can legitimately remain open for many minutes.
 * The configured request timeout therefore bounds connection/header latency,
 * while the caller signal remains active for the entire response body.
 */
export function requestHeaderSignal(
  config: ResolvedConfig,
  callerSignal?: AbortSignal | null,
): { signal: AbortSignal; clearDeadline: () => void } {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );
  }, config.requestTimeoutMs);
  let deadlineCleared = false;

  return {
    signal: combineSignals(timeoutController.signal, callerSignal),
    clearDeadline: () => {
      if (deadlineCleared) return;
      deadlineCleared = true;
      clearTimeout(timeout);
    },
  };
}
