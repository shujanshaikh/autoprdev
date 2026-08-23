import { hasNumberType } from "@autopr/config/runtime-type";


import type * as SecureStore from "expo-secure-store";
import type * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { WebRequestError, webRequest } from "../api/web";
import type { MobileSession } from "../types";
import { commitRefreshedSession, createSessionPersister } from "./sessionGeneration";

const SESSION_KEY = "autopr.mobile.session.v1";
const VERIFIER_KEY = "autopr.mobile.pkce-verifier.v1";
const REDIRECT_URI = "autopr://auth/callback";
const REFRESH_BUFFER_MS = 90_000;

type AuthContextValue = {
  session: MobileSession | null;
  isLoading: boolean;
  authError: string | null;
  signIn: (options?: {
    screenHint?: "sign-in" | "sign-up";
    provider?: "authkit" | "google";
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<string | null>;
  getAccessToken: (forceRefresh?: boolean) => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthDependencies {
  secureStore: Pick<typeof SecureStore, "deleteItemAsync" | "getItemAsync" | "setItemAsync">;
  webBrowser: {
    maybeCompleteAuthSession: (...parameters: Parameters<typeof WebBrowser.maybeCompleteAuthSession>) => void;
    openAuthSessionAsync: typeof WebBrowser.openAuthSessionAsync;
  };
  webRequest: typeof webRequest;
}

const defaultDependencies: AuthDependencies = {
  secureStore: {
    deleteItemAsync: async (...parameters) => (await import("expo-secure-store")).deleteItemAsync(...parameters),
    getItemAsync: async (...parameters) => (await import("expo-secure-store")).getItemAsync(...parameters),
    setItemAsync: async (...parameters) => (await import("expo-secure-store")).setItemAsync(...parameters),
  },
  webBrowser: {
    maybeCompleteAuthSession: (...parameters) => {
      void import("expo-web-browser").then((module) => module.maybeCompleteAuthSession(...parameters));
    },
    openAuthSessionAsync: async (...parameters) =>
      await (await import("expo-web-browser")).openAuthSessionAsync(...parameters),
  },
  webRequest,
};

function tokenExpiresAt(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = globalThis.atob(padded);
    const value = JSON.parse(decoded) satisfies { exp?: unknown };
    return hasNumberType(value.exp) ? value.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function saveSession(session: MobileSession | null, dependencies: AuthDependencies) {
  if (session) {
    await dependencies.secureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  } else {
    await dependencies.secureStore.deleteItemAsync(SESSION_KEY);
  }
}

export function AuthProvider({
  children,
  dependencies = defaultDependencies,
}: {
  children: ReactNode;
  dependencies?: AuthDependencies;
}) {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);
  const authGenerationRef = useRef(0);
  const [persistSession] = useState(() => createSessionPersister({
    currentGeneration: () => authGenerationRef.current,
    persist: (next) => saveSession(next, dependencies),
  }));

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    dependencies.webBrowser.maybeCompleteAuthSession();
    let active = true;
    void dependencies.secureStore.getItemAsync(SESSION_KEY)
      .then((stored) => {
        if (!active || !stored) return;
        const parsed = JSON.parse(stored) satisfies MobileSession;
        if (parsed.accessToken && parsed.refreshToken && parsed.user?.id) {
          setSession(parsed);
        }
      })
      .catch(() => {
        if (active) setAuthError("The saved session could not be restored.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dependencies]);

  const refresh = useCallback(async () => {
    if (refreshPromiseRef.current) return await refreshPromiseRef.current;
    const refreshToken = sessionRef.current?.refreshToken;
    if (!refreshToken) return null;
    const generation = authGenerationRef.current;

    let request: Promise<string | null>;
    request = dependencies.webRequest<MobileSession>("/api/mobile/auth", null, {
      method: "POST",
      body: JSON.stringify({ action: "refresh", refreshToken }),
    })
      .then(async (next) => await commitRefreshedSession({
        session: next,
        generation,
        currentGeneration: () => authGenerationRef.current,
        applySession: (accepted) => {
          sessionRef.current = accepted;
          setSession(accepted);
          setAuthError(null);
        },
        persistSession,
      }))
      .catch(async <CauseValue,>(cause: CauseValue) => {
        if (generation !== authGenerationRef.current) return null;
        const isAuthFailure = cause instanceof WebRequestError
          && (cause.status === 400 || cause.status === 401 || cause.status === 403);
        if (!isAuthFailure) {
          setAuthError("Could not reach the server. Check your connection.");
          return null;
        }
        authGenerationRef.current += 1;
        sessionRef.current = null;
        setSession(null);
        setAuthError("Your session expired. Sign in again.");
        await persistSession(null, authGenerationRef.current);
        return null;
      })
      .finally(() => {
        if (refreshPromiseRef.current === request) {
          refreshPromiseRef.current = null;
        }
      });
    refreshPromiseRef.current = request;
    return await request;
  }, [dependencies, persistSession]);

  const getAccessToken = useCallback(async (forceRefresh = false) => {
    const current = sessionRef.current;
    if (!current) return null;
    const expiresAt = tokenExpiresAt(current.accessToken);
    if (forceRefresh || (expiresAt > 0 && expiresAt <= Date.now() + REFRESH_BUFFER_MS)) {
      return await refresh();
    }
    return current.accessToken;
  }, [refresh]);

  const signIn = useCallback(async ({
    screenHint = "sign-in",
    provider = "authkit",
  }: {
    screenHint?: "sign-in" | "sign-up";
    provider?: "authkit" | "google";
  } = {}) => {
    setAuthError(null);
    try {
      const flow = await dependencies.webRequest<{
        url: string;
        state: string;
        codeVerifier: string;
      }>("/api/mobile/auth", null, {
        method: "POST",
        body: JSON.stringify({
          action: "start",
          redirectUri: REDIRECT_URI,
          screenHint,
          provider,
        }),
      });
      await dependencies.secureStore.setItemAsync(VERIFIER_KEY, flow.codeVerifier);
      const result = await dependencies.webBrowser.openAuthSessionAsync(flow.url, REDIRECT_URI);
      if (result.type !== "success") {
        await dependencies.secureStore.deleteItemAsync(VERIFIER_KEY);
        return;
      }

      const callback = new URL(result.url);
      const code = callback.searchParams.get("code");
      const returnedState = callback.searchParams.get("state");
      const verifier = await dependencies.secureStore.getItemAsync(VERIFIER_KEY);
      await dependencies.secureStore.deleteItemAsync(VERIFIER_KEY);
      if (!code || !verifier || returnedState !== flow.state) {
        throw new Error("The sign-in response could not be verified.");
      }

      const next = await dependencies.webRequest<MobileSession>("/api/mobile/auth", null, {
        method: "POST",
        body: JSON.stringify({ action: "exchange", code, codeVerifier: verifier }),
      });
      authGenerationRef.current += 1;
      refreshPromiseRef.current = null;
      sessionRef.current = next;
      setSession(next);
      setAuthError(null);
      await persistSession(next, authGenerationRef.current);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in failed.");
    }
  }, [dependencies, persistSession]);

  const signOut = useCallback(async () => {
    const accessToken = sessionRef.current?.accessToken ?? null;
    authGenerationRef.current += 1;
    sessionRef.current = null;
    refreshPromiseRef.current = null;
    setSession(null);
    setAuthError(null);
    await persistSession(null, authGenerationRef.current);
    if (!accessToken) return;

    let revokeError: string | null = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      await dependencies.webRequest<{ success: boolean }>("/api/mobile/auth", accessToken, {
        method: "POST",
        body: JSON.stringify({ action: "logout" }),
        signal: controller.signal,
      });
    } catch (cause) {
      revokeError = cause instanceof Error
        ? `Signed out on this device, but the server session could not be revoked: ${cause.message}`
        : "Signed out on this device, but the server session could not be revoked.";
    } finally {
      clearTimeout(timeout);
    }
    setAuthError(revokeError);
  }, [dependencies, persistSession]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    isLoading,
    authError,
    signIn,
    signOut,
    refresh,
    getAccessToken,
  }), [authError, getAccessToken, isLoading, refresh, session, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
