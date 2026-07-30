import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { webRequest } from "../api/web";
import type { MobileSession } from "../types";

WebBrowser.maybeCompleteAuthSession();

const SESSION_KEY = "autopr.mobile.session.v1";
const VERIFIER_KEY = "autopr.mobile.pkce-verifier.v1";
const REDIRECT_URI = "autopr://auth/callback";
const REFRESH_BUFFER_MS = 90_000;

type AuthContextValue = {
  session: MobileSession | null;
  isLoading: boolean;
  authError: string | null;
  signIn: (screenHint?: "sign-in" | "sign-up") => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<string | null>;
  getAccessToken: (forceRefresh?: boolean) => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function tokenExpiresAt(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = globalThis.atob(padded);
    const value = JSON.parse(decoded) as { exp?: unknown };
    return typeof value.exp === "number" ? value.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function saveSession(session: MobileSession | null) {
  if (session) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  } else {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<MobileSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(SESSION_KEY)
      .then((stored) => {
        if (!active || !stored) return;
        const parsed = JSON.parse(stored) as MobileSession;
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
  }, []);

  const refresh = useCallback(async () => {
    if (refreshPromiseRef.current) return await refreshPromiseRef.current;
    const refreshToken = sessionRef.current?.refreshToken;
    if (!refreshToken) return null;

    const request = webRequest<MobileSession>("/api/mobile/auth", null, {
      method: "POST",
      body: JSON.stringify({ action: "refresh", refreshToken }),
    })
      .then(async (next) => {
        setSession(next);
        setAuthError(null);
        await saveSession(next);
        return next.accessToken;
      })
      .catch(async () => {
        setSession(null);
        setAuthError("Your session expired. Sign in again.");
        await saveSession(null);
        return null;
      })
      .finally(() => {
        refreshPromiseRef.current = null;
      });
    refreshPromiseRef.current = request;
    return await request;
  }, []);

  const getAccessToken = useCallback(async (forceRefresh = false) => {
    const current = sessionRef.current;
    if (!current) return null;
    const expiresAt = tokenExpiresAt(current.accessToken);
    if (forceRefresh || (expiresAt > 0 && expiresAt <= Date.now() + REFRESH_BUFFER_MS)) {
      return await refresh();
    }
    return current.accessToken;
  }, [refresh]);

  const signIn = useCallback(async (screenHint: "sign-in" | "sign-up" = "sign-in") => {
    setAuthError(null);
    try {
      const flow = await webRequest<{
        url: string;
        state: string;
        codeVerifier: string;
      }>("/api/mobile/auth", null, {
        method: "POST",
        body: JSON.stringify({ action: "start", redirectUri: REDIRECT_URI, screenHint }),
      });
      await SecureStore.setItemAsync(VERIFIER_KEY, flow.codeVerifier);
      const result = await WebBrowser.openAuthSessionAsync(flow.url, REDIRECT_URI);
      if (result.type !== "success") return;

      const callback = new URL(result.url);
      const code = callback.searchParams.get("code");
      const returnedState = callback.searchParams.get("state");
      const verifier = await SecureStore.getItemAsync(VERIFIER_KEY);
      await SecureStore.deleteItemAsync(VERIFIER_KEY);
      if (!code || !verifier || returnedState !== flow.state) {
        throw new Error("The sign-in response could not be verified.");
      }

      const next = await webRequest<MobileSession>("/api/mobile/auth", null, {
        method: "POST",
        body: JSON.stringify({ action: "exchange", code, codeVerifier: verifier }),
      });
      setSession(next);
      setAuthError(null);
      await saveSession(next);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in failed.");
    }
  }, []);

  const signOut = useCallback(async () => {
    const accessToken = sessionRef.current?.accessToken ?? null;
    setSession(null);
    setAuthError(null);
    await saveSession(null);
    if (accessToken) {
      await webRequest("/api/mobile/auth", accessToken, {
        method: "POST",
        body: JSON.stringify({ action: "logout" }),
      }).catch(() => undefined);
    }
  }, []);

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
