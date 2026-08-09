import { createXai } from "@ai-sdk/xai";

export const GROK_OAUTH_DUMMY_API_KEY = "xai-oauth-managed-by-autopr";

export function createGrokOAuthProvider(options: {
  accessToken: () => string | Promise<string>;
  fetch?: typeof fetch;
  baseURL?: string;
  userAgent?: string;
}) {
  return createXai({
    apiKey: GROK_OAUTH_DUMMY_API_KEY,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    fetch: createGrokOAuthFetch(options),
  });
}

export function createGrokOAuthFetch(options: {
  accessToken: () => string | Promise<string>;
  fetch?: typeof fetch;
  userAgent?: string;
}) {
  const requestFetch = options.fetch ?? fetch;
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    headers.set("Authorization", `Bearer ${await options.accessToken()}`);
    headers.set("User-Agent", options.userAgent?.trim() || "autopr/0.0.0");
    return requestFetch(input, { ...init, headers });
  };
}

export type GrokResponsesModel = ReturnType<ReturnType<typeof createGrokOAuthProvider>["responses"]>;
