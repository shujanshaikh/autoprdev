export const DESKTOP_PREVIEW_HEARTBEAT_MS = 5 * 60 * 1_000;

const DESKTOP_PREVIEW_RETRY_DELAYS_MS = [250, 500, 1_000] as const;

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
