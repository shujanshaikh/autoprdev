import { createXai } from "@ai-sdk/xai";

export const GROK_OAUTH_DUMMY_API_KEY = "xai-oauth-managed-by-autopr";

export function createGrokOAuthProvider(options: {
  accessToken: () => string | Promise<string>;
  fetch?: typeof fetch;
  baseURL?: string;
  userAgent?: string;
  promptCacheKey?: string;
  reasoningEffort?: "xhigh";
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
  promptCacheKey?: string;
  reasoningEffort?: "xhigh";
}) {
  const requestFetch = options.fetch ?? fetch;
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    headers.set("Authorization", `Bearer ${await options.accessToken()}`);
    headers.set("User-Agent", options.userAgent?.trim() || "autopr/0.0.0");
    let body = init?.body;
    if (body === undefined && input instanceof Request && isJsonRequest(input)) {
      body = await input.clone().text();
    }
    return requestFetch(input, {
      ...init,
      headers,
      body: withResponsesOverrides(input, body, {
        promptCacheKey: options.promptCacheKey,
        reasoningEffort: options.reasoningEffort,
      }),
    });
  };
}

function isJsonRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("application/json") || contentType.includes("+json");
}

function withResponsesOverrides(
  input: Parameters<typeof fetch>[0],
  body: RequestInit["body"],
  options: {
    promptCacheKey?: string;
    reasoningEffort?: "xhigh";
  },
) {
  const key = options.promptCacheKey?.trim();
  const url = input instanceof Request ? input.url : String(input);
  if ((!key && !options.reasoningEffort) || !/\/responses(?:\?|$)/.test(url) || typeof body !== "string") {
    return body;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return body;
    const request = parsed as Record<string, unknown>;
    const reasoning = typeof request.reasoning === "object" && request.reasoning !== null && !Array.isArray(request.reasoning)
      ? request.reasoning as Record<string, unknown>
      : {};
    return JSON.stringify({
      ...request,
      ...(key ? { prompt_cache_key: key } : {}),
      ...(options.reasoningEffort
        ? { reasoning: { ...reasoning, effort: options.reasoningEffort } }
        : {}),
    });
  } catch {
    return body;
  }
}

export type GrokResponsesModel = ReturnType<ReturnType<typeof createGrokOAuthProvider>["responses"]>;
