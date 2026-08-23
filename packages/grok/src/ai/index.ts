import { hasObjectType, hasStringType } from "@autopr/config/runtime-type";
import { type JsonObject } from "@autopr/config/runtime-value";
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
    ...(() => {
  let optionalProperties;
  if (options.baseURL) optionalProperties = { baseURL: options.baseURL };
  return optionalProperties;
})(),
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
  if ((!key && !options.reasoningEffort) || !/\/responses(?:\?|$)/.test(url) || !hasStringType(body)) {
    return body;
  }

  try {
    const parsed = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ JSON.parse(body) as unknown;
    if (!hasObjectType(parsed) || parsed === null || Array.isArray(parsed)) return body;
    const request = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ parsed as JsonObject;
    const reasoning = hasObjectType(request.reasoning) && request.reasoning !== null && !Array.isArray(request.reasoning)
      ? /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ request.reasoning as JsonObject
      : {};
    return JSON.stringify({
      ...request,
      ...(() => {
  let optionalProperties;
  if (key) optionalProperties = { prompt_cache_key: key };
  return optionalProperties;
})(),
      ...(() => {
  let optionalProperties;
  if (options.reasoningEffort) optionalProperties = { reasoning: { ...reasoning, effort: options.reasoningEffort } };
  return optionalProperties;
})(),
    });
  } catch {
    return body;
  }
}

export type GrokResponsesModel = ReturnType<ReturnType<typeof createGrokOAuthProvider>["responses"]>;
