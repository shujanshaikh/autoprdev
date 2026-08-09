import type { ResolvedConfig } from "../config.ts";

/** Combines caller cancellation with the configured deadline for an outbound request. */
export function requestSignal(config: ResolvedConfig, callerSignal?: AbortSignal | null): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs);
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
