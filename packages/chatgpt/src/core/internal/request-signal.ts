import type { ResolvedConfig } from "../config.ts";

/** Combines caller cancellation with the configured deadline for an outbound request. */
export function requestSignal(config: ResolvedConfig, callerSignal?: AbortSignal | null): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs);
  return callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
}
