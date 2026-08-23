import { isJsonObject } from "@autopr/config/runtime-value";

export const DESKTOP_PREVIEW_HEARTBEAT_MS = 5 * 60 * 1_000;
export const DESKTOP_PREVIEW_REFRESH_MARGIN_MS = 30_000;

const DESKTOP_PREVIEW_RETRY_DELAYS_MS = [250, 500, 1_000] as const;
const desktopActivitySubscriptions = new Map<string, {
  callbacks: Set<() => Promise<void | null>>;
  timer: ReturnType<typeof setInterval>;
}>();

export type DaytonaDesktopPreview = {
  url: string;
  websocketUrl: string;
  port: number;
  expiresInSeconds: number;
};

export type DaytonaDesktopConnection = {
  projectId: string;
  websocketUrl: string;
  expiresAt: number;
  revision: number;
};

export type DaytonaDesktopSessionSnapshot = {
  connection?: DaytonaDesktopConnection;
  loading: boolean;
  error?: string;
};

type DaytonaDesktopSessionRequestOptions = {
  recoverStream?: boolean;
  preserveConnection?: boolean;
  failedRevision?: number;
};

type Listener = () => void;

function createDesktopSession(
  projectId: string,
  onListenerCountChange: (count: number) => void,
) {
  const listeners = new Set<Listener>();
  let snapshot: DaytonaDesktopSessionSnapshot = { loading: false };
  let pending: Promise<boolean> | undefined;

  const publish = (next: DaytonaDesktopSessionSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    getSubscriberCount: () => listeners.size,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      onListenerCountChange(listeners.size);
      return () => {
        listeners.delete(listener);
        onListenerCountChange(listeners.size);
      };
    },
    request: (
      requestPreview: () => Promise<DaytonaDesktopPreview>,
      {
        recoverStream = false,
        preserveConnection = false,
        failedRevision,
      }: DaytonaDesktopSessionRequestOptions = {},
    ) => {
      const currentConnection = snapshot.connection;

      // A viewer may report an old RFB failure after another viewer has
      // already recovered the route. The accepted generation wins.
      if (
        failedRevision !== undefined
        && currentConnection
        && failedRevision < currentConnection.revision
      ) {
        return Promise.resolve("current" as const);
      }

      if (
        !recoverStream
        && currentConnection
        && Date.now() < currentConnection.expiresAt - DESKTOP_PREVIEW_REFRESH_MARGIN_MS
      ) {
        return Promise.resolve(true);
      }

      if (pending) return pending;

      const connectionAtRequest = currentConnection;
      publish({ connection: currentConnection, loading: true });

      const request = requestDesktopPreviewWithRetry(requestPreview)
        .then((preview) => {
          if (pending !== request) return false;
          pending = undefined;
          const revision = Math.max(
            connectionAtRequest?.revision ?? 0,
            snapshot.connection?.revision ?? 0,
          ) + 1;
          publish({
            connection: {
              projectId,
              websocketUrl: preview.websocketUrl,
              expiresAt: Date.now() + preview.expiresInSeconds * 1_000,
              revision,
            },
            loading: false,
          });
          return true;
        })
        .catch((cause: unknown) => {
          if (pending !== request) return false;
          pending = undefined;

          if (
            connectionAtRequest
            && (
              preserveConnection
              || Date.now() < connectionAtRequest.expiresAt
            )
          ) {
            publish({ connection: connectionAtRequest, loading: false });
            return false;
          }

          publish({
            loading: false,
            error: cause instanceof Error ? cause.message : "Could not open the desktop preview.",
          });
          return false;
        });

      pending = request;
      return request;
    },
  };
}

export type DaytonaDesktopSession = ReturnType<typeof createDesktopSession>;

const desktopSessions = new Map<string, DaytonaDesktopSession>();

/** Creates an isolated session owner, primarily for deterministic lifecycle tests. */
export function createDaytonaDesktopSession(projectId: string) {
  return createDesktopSession(projectId, () => undefined);
}

/** Returns the browser-owned desktop session shared by every viewport for a project. */
export function getDaytonaDesktopSession(projectId: string) {
  const existing = desktopSessions.get(projectId);
  if (existing) return existing;

  let session!: DaytonaDesktopSession;
  session = createDesktopSession(projectId, (listenerCount) => {
    if (listenerCount > 0) {
      desktopSessions.set(projectId, session);
      return;
    }

    if (
      desktopSessions.get(projectId) === session
      && session.getSubscriberCount() === 0
    ) {
      desktopSessions.delete(projectId);
    }
  });
  desktopSessions.set(projectId, session);
  return session;
}

/** Clears module state between isolated browser lifecycle tests. */
export function resetDaytonaDesktopSessionsForTests() {
  desktopSessions.clear();
}

function errorText<ErrorValue>(error: ErrorValue) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (!isJsonObject(error) || !("data" in error)) {
    return message;
  }

  try {
    return `${message} ${JSON.stringify(error.data)}`;
  } catch {
    return message;
  }
}

export function isRetryableDesktopPreviewError<ErrorValue>(error: ErrorValue) {
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

/** Keeps one Daytona activity heartbeat per open project, regardless of viewer count. */
export function subscribeDesktopActivity(
  projectId: string,
  refresh: () => Promise<void | null>,
): () => void {
  let subscription = desktopActivitySubscriptions.get(projectId);
  if (!subscription) {
    const callbacks = new Set<() => Promise<void | null>>();
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
