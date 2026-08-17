// @vitest-environment jsdom
// @vitest-environment jsdom
import { type JsonValue } from "@autopr/config/runtime-value";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WebRequestError } from "../api/web";
import type { MobileSession } from "../types";
import { AuthProvider, useAuth } from "./AuthProvider";

const SESSION_KEY = "autopr.mobile.session.v1";

const { webRequestMock, secureStore } = vi.hoisted(() => ({
  webRequestMock: vi.fn<
    (path: string, accessToken: string | null, init?: RequestInit) => Promise<JsonValue>
  >(),
  secureStore: {
    store: new Map<string, string>(),
    deferredWrite: /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ null as { promise: Promise<void> } | null,
  },
}));

const secureStoreApi = {
  getItemAsync: vi.fn(async (key: string) => secureStore.store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStore.store.set(key, value);
    const deferred = secureStore.deferredWrite;
    secureStore.deferredWrite = null;
    if (deferred) await deferred.promise;
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStore.store.delete(key);
  }),
};

const webBrowser = {
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(async () => ({
    type: "success" as const,
    url: "autopr://auth/callback?code=code-1&state=state-1",
  })),
};

const dependencies = {
  secureStore: secureStoreApi,
  webBrowser,
  webRequest: async <Result,>(...parameters: Parameters<typeof webRequestMock>) =>
    /* SAFETY: The fake endpoint is controlled by each test and returns the result type requested by AuthProvider. */
    await webRequestMock(...parameters) as Result,
};

const sessionA: MobileSession = {
  accessToken: "access-token-a",
  refreshToken: "refresh-token-a",
  user: {
    id: "user-a",
    email: "a@example.com",
    firstName: null,
    lastName: null,
    profilePictureUrl: null,
  },
};

const sessionB: MobileSession = {
  accessToken: "access-token-b",
  refreshToken: "refresh-token-b",
  user: {
    id: "user-b",
    email: "b@example.com",
    firstName: null,
    lastName: null,
    profilePictureUrl: null,
  },
};

const refreshedSessionA: MobileSession = {
  accessToken: "access-token-a-refreshed",
  refreshToken: "refresh-token-a-refreshed",
  user: sessionA.user,
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: <ReasonValue>(reason?: ReasonValue) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let auth: ReturnType<typeof useAuth> | null = null;

function AuthProbe() {
  auth = useAuth();
  return null;
}

describe("AuthProvider", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    secureStore.store.clear();
    secureStore.deferredWrite = null;
    auth = null;
  });

  it("keeps session B when a refresh started before sign-in fails afterwards", async () => {
    await secureStoreApi.setItemAsync(SESSION_KEY, JSON.stringify(sessionA));

    const refreshA = createDeferred<MobileSession>();
    webRequestMock.mockImplementation((_path, _accessToken, init) => {
      const { action } = JSON.parse(String(init?.body ?? "{}")) satisfies { action?: string };
      switch (action) {
        case "refresh":
          return refreshA.promise;
        case "start":
          return Promise.resolve({
            url: "https://auth.example.com/authorize",
            state: "state-1",
            codeVerifier: "verifier-1",
          });
        case "exchange":
          return Promise.resolve(sessionB);
        default:
          return Promise.reject(new Error(`Unexpected action: ${String(action)}`));
      }
    });

    render(
      <AuthProvider dependencies={dependencies}>
        <AuthProbe />
      </AuthProvider>,
    );
    await act(async () => {});
    expect(auth?.session).toEqual(sessionA);

    let refreshPromise: Promise<string | null> | null = null;
    act(() => {
      refreshPromise = auth!.refresh();
    });

    await act(async () => {
      await auth!.signIn();
    });
    expect(auth?.session).toEqual(sessionB);

    await act(async () => {
      refreshA.reject(new WebRequestError("The refresh token is no longer valid.", 401));
      await refreshPromise;
    });

    await expect(refreshPromise).resolves.toBeNull();
    expect(auth?.session).toEqual(sessionB);
    expect(auth?.authError).toBeNull();

    const stored = await secureStoreApi.getItemAsync(SESSION_KEY);
    expect(stored ? JSON.parse(stored) : null).toEqual(sessionB);
  });

  it("keeps the fresh session persisted when a stale refresh, sign-out, and sign-in interleave", async () => {
    await secureStoreApi.setItemAsync(SESSION_KEY, JSON.stringify(sessionA));

    const refreshA = createDeferred<MobileSession>();
    webRequestMock.mockImplementation((_path, _accessToken, init) => {
      const { action } = JSON.parse(String(init?.body ?? "{}")) satisfies { action?: string };
      switch (action) {
        case "refresh":
          return refreshA.promise;
        case "start":
          return Promise.resolve({
            url: "https://auth.example.com/authorize",
            state: "state-1",
            codeVerifier: "verifier-1",
          });
        case "exchange":
          return Promise.resolve(sessionB);
        case "logout":
          return Promise.resolve({ success: true });
        default:
          return Promise.reject(new Error(`Unexpected action: ${String(action)}`));
      }
    });

    render(
      <AuthProvider dependencies={dependencies}>
        <AuthProbe />
      </AuthProvider>,
    );
    await act(async () => {});
    expect(auth?.session).toEqual(sessionA);

    // Start refresh-A and let it succeed, but block its SecureStore write so
    // sign-out and a fresh sign-in interleave while it is being persisted.
    let refreshPromise: Promise<string | null> | null = null;
    act(() => {
      refreshPromise = auth!.refresh();
    });
    const writeGate = createDeferred<void>();
    secureStore.deferredWrite = { promise: writeGate.promise };
    await act(async () => {
      refreshA.resolve(refreshedSessionA);
    });

    let signOutPromise: Promise<void> | null = null;
    await act(async () => {
      signOutPromise = auth!.signOut();
    });
    let signInPromise: Promise<void> | null = null;
    await act(async () => {
      signInPromise = auth!.signIn();
    });
    expect(auth?.session).toEqual(sessionB);

    await act(async () => {
      writeGate.resolve();
      await Promise.all([refreshPromise!, signOutPromise!, signInPromise!]);
    });

    await expect(refreshPromise!).resolves.toBeNull();
    expect(auth?.session).toEqual(sessionB);
    expect(auth?.authError).toBeNull();

    const stored = await secureStoreApi.getItemAsync(SESSION_KEY);
    expect(stored ? JSON.parse(stored) : null).toEqual(sessionB);
  });
});
