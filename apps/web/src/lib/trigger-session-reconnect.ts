const BASE_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 5_000;

export function shouldUseTriggerSessionTransport(options: {
  sessionCreatedAt?: number;
  currentRunId?: string;
}) {
  return Boolean(options.sessionCreatedAt) || !options.currentRunId;
}

export function triggerSessionHydration(
  publicAccessToken: string,
  lastEventId?: string,
) {
  return {
    publicAccessToken,
    lastEventId,
  };
}

export function triggerSessionReconnectDelayMs(attempt: number) {
  return Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** Math.max(0, Math.min(attempt, 5)),
    MAX_RECONNECT_DELAY_MS,
  );
}

export async function runTriggerSessionReconnectAttempt(options: {
  resume: () => Promise<void>;
  isSessionLive: () => boolean;
  isTurnCompleted: () => boolean;
}) {
  let error: unknown;

  try {
    await options.resume();
  } catch (resumeError) {
    error = resumeError;
  }

  return {
    error,
    // AI SDK intentionally resolves resumeStream() when the transport reports
    // that no stream is currently attachable. That can be a short race while
    // a durable Trigger turn is still live, so the caller must try again.
    shouldRetry: options.isSessionLive() && !options.isTurnCompleted(),
  };
}
