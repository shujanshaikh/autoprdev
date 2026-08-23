export const DESKTOP_PREVIEW_HEARTBEAT_MS = 5 * 60 * 1_000;
export const DESKTOP_PREVIEW_REFRESH_MARGIN_MS = 30_000;

const DESKTOP_PREVIEW_RETRY_DELAYS_MS = [250, 500, 1_000] as const;
const desktopPreviewRequests = new Map<string, Promise<DaytonaDesktopPreview>>();
const desktopActivitySubscriptions = new Map<string, {
  callbacks: Set<() => Promise<unknown>>;
  timer: ReturnType<typeof setInterval>;
}>();

export type DaytonaDesktopPreview = {
  url: string;
  websocketUrl: string;
  port: number;
  expiresInSeconds: number;
};

function errorText(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return message;
  }

  try {
    return `${message} ${JSON.stringify(error.data)}`;
  } catch {
    return message;
  }
}

export function isRetryableDesktopPreviewError(error: unknown) {
  return /\bUNAUTHORIZED\b|not authenticated|connection (?:closed|lost)|failed to fetch|fetch failed|network error/i
    .test(errorText(error));
}

/** Retries the short auth/network gap that can occur while Convex rotates its token. */
export async function requestDesktopPreviewWithRetry<T>(
  request: () => Promise<T>,
  retryDelaysMs: readonly number[] = DESKTOP_PREVIEW_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined || !isRetryableDesktopPreviewError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/** Shares a preview or recovery request between the compact and full desktop viewers. */
export function requestSharedDesktopPreview(
  projectId: string,
  recoverStream: boolean,
  request: () => Promise<DaytonaDesktopPreview>,
  retryDelaysMs: readonly number[] = DESKTOP_PREVIEW_RETRY_DELAYS_MS,
): Promise<DaytonaDesktopPreview> {
  const key = `${projectId}:${recoverStream ? "recover" : "open"}`;
  const existing = desktopPreviewRequests.get(key);
  if (existing) return existing;

  const pending = requestDesktopPreviewWithRetry(request, retryDelaysMs).finally(() => {
    if (desktopPreviewRequests.get(key) === pending) {
      desktopPreviewRequests.delete(key);
    }
  });
  desktopPreviewRequests.set(key, pending);
  return pending;
}

/** Keeps one Daytona activity heartbeat per open project, regardless of viewer count. */
export function subscribeDesktopActivity(
  projectId: string,
  refresh: () => Promise<unknown>,
): () => void {
  let subscription = desktopActivitySubscriptions.get(projectId);
  if (!subscription) {
    const callbacks = new Set<() => Promise<unknown>>();
    subscription = {
      callbacks,
      timer: setInterval(() => {
        const callback = callbacks.values().next().value;
        if (callback) void callback().catch(() => undefined);
      }, DESKTOP_PREVIEW_HEARTBEAT_MS),
    };
    desktopActivitySubscriptions.set(projectId, subscription);
  }

  subscription.callbacks.add(refresh);
  return () => {
    const current = desktopActivitySubscriptions.get(projectId);
    if (!current) return;
    current.callbacks.delete(refresh);
    if (current.callbacks.size === 0) {
      clearInterval(current.timer);
      desktopActivitySubscriptions.delete(projectId);
    }
  };
}
