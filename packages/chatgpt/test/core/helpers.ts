import { hasStringType } from "@autopr/config/runtime-type";
import { type JsonObject } from "@autopr/config/runtime-value";

import { base64UrlEncode } from "../../src/core/index.ts";

const encoder = new TextEncoder();

/** Builds an unsigned JWT (`alg: none`) with the given claims. */
export function makeJwt(payload: JsonObject): string {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "none", typ: "JWT" })));
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${header}.${body}.sig`;
}

/** Builds an id token carrying the ChatGPT account/plan claims. */
export function makeIdToken(options: {
  accountId?: string;
  email?: string;
  name?: string;
  plan?: string;
  expiresInSeconds?: number;
} = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return makeJwt({
    email: options.email,
    name: options.name,
    exp: now + (options.expiresInSeconds ?? 3600),
    "https://api.openai.com/auth": {
      chatgpt_account_id: options.accountId ?? "acct_123",
      chatgpt_plan_type: options.plan,
    },
  });
}

/** Builds an access token with a specific expiry (epoch seconds offset). */
export function makeAccessToken(expiresInSeconds: number): string {
  return makeJwt({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds });
}

/** Convenience JSON `Response`. */
export function jsonResponse<DataValue>(data: DataValue, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A recording mock fetch driven by a handler function. */
export function createMockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch & { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = hasStringType(input)
      ? input
      : input instanceof Request
        ? input.url
        : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}
