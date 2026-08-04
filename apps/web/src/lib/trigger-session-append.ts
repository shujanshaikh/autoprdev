const MAX_APPEND_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 200;
const MAX_RETRY_DELAY_MS = 1_000;

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
  fetcher?: Fetcher;
  waitForRetry?: WaitForRetry;
}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  const headers = new Headers(options.headers);

  if (!headers.has("X-Part-Id")) {
    headers.set("X-Part-Id", crypto.randomUUID());
  }

  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
    const response = await fetcher(options.url, {
      method: "POST",
      headers,
      body: options.body,
      signal: options.signal,
    });

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
