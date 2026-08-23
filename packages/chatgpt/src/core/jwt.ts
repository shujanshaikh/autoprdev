import { hasNumberType, hasStringType } from "@autopr/config/runtime-type";
import { isJsonObject, type JsonObject } from "@autopr/config/runtime-value";

import { AUTH_CLAIM } from "./constants.ts";
import { base64UrlDecodeToString } from "./internal/base64.ts";
import type { ChatGPTUser } from "./types.ts";

/**
 * Decodes a JWT payload without verifying its signature.
 *
 * These tokens come straight from OpenAI's token endpoint over TLS, so we only
 * read claims we already trust. Never use this to validate a token from an
 * untrusted source.
 */
export function decodeJwt(token: string | undefined): JsonObject | undefined {
  if (!hasStringType(token)) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const parsed = JSON.parse(base64UrlDecodeToString(parts[1]));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Extracts the `exp` claim as epoch milliseconds, or `undefined`. */
export function getTokenExpiry(token: string | undefined): number | undefined {
  const claims = decodeJwt(token);
  const exp = claims?.["exp"];
  return hasNumberType(exp) ? exp * 1000 : undefined;
}

/** Reads the ChatGPT account id from an id (or access) token. */
export function deriveAccountId(token: string | undefined): string | undefined {
  const auth = decodeJwt(token)?.[AUTH_CLAIM];
  if (isRecord(auth) && hasStringType(auth["chatgpt_account_id"])) {
    return auth["chatgpt_account_id"];
  }
  return undefined;
}

/** Builds a public {@link ChatGPTUser} profile from an id token. */
export function parseUser(idToken: string | undefined): ChatGPTUser | undefined {
  const claims = decodeJwt(idToken);
  if (!claims) return undefined;
  const accountId = deriveAccountId(idToken);
  if (!accountId) return undefined;

  const auth = isRecord(claims[AUTH_CLAIM]) ? (/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ claims[AUTH_CLAIM] as JsonObject) : {};
  return {
    accountId,
    email: asString(claims["email"]),
    name: asString(claims["name"]),
    plan: asString(auth["chatgpt_plan_type"]),
  };
}

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}

function asString<ValueValue>(value: ValueValue): string | undefined {
  return hasStringType(value) && value.length > 0 ? value : undefined;
}
