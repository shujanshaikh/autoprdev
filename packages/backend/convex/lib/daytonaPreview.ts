const PREVIEW_PROBE_TIMEOUT_MS = 3_000;
const PREVIEW_ROUTE_TIMEOUT_MS = 15_000;
const PREVIEW_ROUTE_RETRY_DELAYS_MS = [0, 250, 500, 1_000, 2_000, 3_000, 4_000] as const;

type PreviewRouteProbe = (url: string) => Promise<number>;

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function probePreviewRoute(url: string): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_PROBE_TIMEOUT_MS);
  (timer as { unref?: () => void }).unref?.();

  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

/** Appends a service route without discarding a signed preview token path. */
export function previewWebsocketUrl(value: string, route: string): string {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const basePath = url.pathname.replace(/\/$/, "");
  const childPath = route.replace(/^\/+/, "");
  url.pathname = `${basePath}/${childPath}`;
  url.hash = "";
  return url.toString();
}

/**
 * Waits until the provider's public preview proxy can reach the sandbox port. A
 * local listening socket is not enough because the proxy route converges
 * separately after a sandbox or desktop process starts.
 */
export async function waitForPreviewRoute(
  url: string,
  options: {
    probe?: PreviewRouteProbe;
    retryDelaysMs?: readonly number[];
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const probe = options.probe ?? probePreviewRoute;
  const retryDelaysMs = options.retryDelaysMs ?? PREVIEW_ROUTE_RETRY_DELAYS_MS;
  const deadline = Date.now() + (options.timeoutMs ?? PREVIEW_ROUTE_TIMEOUT_MS);
  let lastStatus: number | undefined;

  for (const retryDelayMs of retryDelaysMs) {
    if (Date.now() + retryDelayMs > deadline) break;
    await delay(retryDelayMs);
    try {
      const status = await probe(url);
      lastStatus = status;
      if (status >= 200 && status < 500 && status !== 401 && status !== 403 && status !== 429) {
        return;
      }
    } catch {
      // The proxy can refuse connections while its sandbox route converges.
    }
    if (Date.now() >= deadline) break;
  }

  const detail = lastStatus === undefined
    ? "connection failed"
    : `HTTP ${lastStatus}`;
  throw new Error(`Sandbox desktop preview route did not become reachable: ${detail}.`);
}
