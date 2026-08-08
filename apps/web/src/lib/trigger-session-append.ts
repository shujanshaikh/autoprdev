const MAX_APPEND_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 200;
const MAX_RETRY_DELAY_MS = 1_000;
const DEFAULT_APPEND_ATTEMPT_TIMEOUT_MS = 15_000;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type WaitForRetry = (delayMs: number, signal?: AbortSignal) => Promise<void>;

function defaultWaitForRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

export function triggerSessionAppendRetryDelayMs(attempt: number) {
  return Math.min(
    BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt),
    MAX_RETRY_DELAY_MS,
  );
}

function trustedHttpsUrl(raw: string, expectedOrigin?: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Trigger.dev session append URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Trigger.dev session appends require HTTPS.");
  }
  if (expectedOrigin && url.origin !== new URL(expectedOrigin).origin) {
    throw new Error("Trigger.dev session append URL does not match the configured origin.");
  }
  return url;
}

function attemptSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Trigger.dev append attempt timed out.", "TimeoutError")),
    timeoutMs,
  );

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

/**
 * Trigger.dev documents session-input 500s as transient and append retries as
 * idempotent when X-Part-Id is reused. Keep that retry at the authenticated
 * proxy boundary so every browser transport gets the same behavior.
 */
export async function appendToTriggerSession(options: {
  url: string;
  body: string;
  headers: HeadersInit;
  signal?: AbortSignal;
  trustedOrigin?: string;
  attemptTimeoutMs?: number;
  fetcher?: Fetcher;
  waitForRetry?: WaitForRetry;
}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  const headers = new Headers(options.headers);
  const url = trustedHttpsUrl(options.url, options.trustedOrigin);
  const timeoutMs = options.attemptTimeoutMs ?? DEFAULT_APPEND_ATTEMPT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error("Trigger.dev append attempt timeout must be positive.");
  }

  if (!headers.has("X-Part-Id")) {
    headers.set("X-Part-Id", crypto.randomUUID());
  }

  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
    const attemptController = attemptSignal(options.signal, timeoutMs);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers,
        body: options.body,
        redirect: "error",
        signal: attemptController.signal,
      });
    } catch (error) {
      if (options.signal?.aborted || attempt === MAX_APPEND_ATTEMPTS - 1) throw error;
      await waitForRetry(triggerSessionAppendRetryDelayMs(attempt), options.signal);
      continue;
    } finally {
      attemptController.dispose();
    }

    if (response.status !== 500 || attempt === MAX_APPEND_ATTEMPTS - 1) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);
    await waitForRetry(
      triggerSessionAppendRetryDelayMs(attempt),
      options.signal,
    );
  }

  throw new Error("Trigger.dev session append exhausted without a response.");
}
