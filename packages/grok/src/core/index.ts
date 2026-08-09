export const GROK_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const GROK_DEVICE_AUTHORIZATION_URL = "https://auth.x.ai/oauth2/device/code";
export const GROK_API_BASE_URL = "https://api.x.ai/v1";
export const GROK_OAUTH_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const GROK_DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
// OpenCode keeps provider availability separate from OAuth and sources its
// xAI catalog from models.opencode.ai. Keep a local, harness-compatible
// snapshot so a successful login never appears disconnected merely because
// xAI's API-key-oriented /models endpoint rejects a subscription token.
export const GROK_FALLBACK_MODELS = [
  "grok-build-0.1",
  "grok-4.20-0309-reasoning",
  "grok-4.20-0309-non-reasoning",
  "grok-4.5",
  "grok-4.3",
  "grok-4",
  "grok-code-fast-1",
  "grok-3-mini",
] as const;

export type GrokOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  idToken?: string;
  scope?: string;
  tokenType?: string;
};

export type GrokDeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInSeconds: number;
  intervalSeconds: number;
};

export type GrokDeviceTokenResult =
  | { status: "pending"; slowDown: boolean }
  | { status: "success"; tokens: GrokOAuthTokens }
  | { status: "denied" }
  | { status: "expired" };

type GrokOAuthOptions = {
  tokenUrl?: string;
  deviceAuthorizationUrl?: string;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  userAgent?: string;
};

export class GrokOAuthError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "GrokOAuthError";
  }
}

export async function requestGrokDeviceCode(
  options: GrokOAuthOptions & { referrer?: string } = {},
): Promise<GrokDeviceCode> {
  const response = await (options.fetch ?? fetch)(
    options.deviceAuthorizationUrl ?? GROK_DEVICE_AUTHORIZATION_URL,
    {
      method: "POST",
      headers: authHeaders(options.userAgent),
      body: new URLSearchParams({
        client_id: GROK_OAUTH_CLIENT_ID,
        scope: GROK_OAUTH_SCOPE,
        referrer: options.referrer?.trim() || "autopr",
      }),
    },
  );
  const body = await readJsonRecord(response);
  if (!response.ok) {
    throw endpointError("xAI device authorization", response.status, body);
  }

  const deviceCode = requireString(body.device_code, "device_code");
  const userCode = requireString(body.user_code, "user_code");
  const verificationUri = requireString(body.verification_uri, "verification_uri");

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: optionalString(body.verification_uri_complete),
    expiresInSeconds: positiveNumber(body.expires_in, 300),
    intervalSeconds: positiveNumber(body.interval, 5),
  };
}

export async function pollGrokDeviceToken(
  deviceCode: string,
  options: GrokOAuthOptions = {},
): Promise<GrokDeviceTokenResult> {
  const response = await (options.fetch ?? fetch)(options.tokenUrl ?? GROK_TOKEN_URL, {
    method: "POST",
    headers: authHeaders(options.userAgent),
    body: new URLSearchParams({
      grant_type: GROK_DEVICE_CODE_GRANT_TYPE,
      client_id: GROK_OAUTH_CLIENT_ID,
      device_code: deviceCode,
    }),
  });
  const body = await readJsonRecord(response);
  if (response.ok) {
    return { status: "success", tokens: parseTokens(body, options.now?.() ?? Date.now()) };
  }

  const code = optionalString(body.error);
  if (code === "authorization_pending") return { status: "pending", slowDown: false };
  if (code === "slow_down") return { status: "pending", slowDown: true };
  if (code === "access_denied" || code === "authorization_denied") return { status: "denied" };
  if (code === "expired_token") return { status: "expired" };
  throw endpointError("xAI device token exchange", response.status, body);
}

export async function refreshGrokTokens(
  refreshToken: string,
  options: GrokOAuthOptions = {},
): Promise<GrokOAuthTokens> {
  const response = await (options.fetch ?? fetch)(options.tokenUrl ?? GROK_TOKEN_URL, {
    method: "POST",
    headers: authHeaders(options.userAgent),
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: GROK_OAUTH_CLIENT_ID,
    }),
  });
  const body = await readJsonRecord(response);
  if (!response.ok) {
    throw endpointError("xAI token refresh", response.status, body);
  }

  return parseTokens(body, options.now?.() ?? Date.now(), refreshToken);
}

export async function fetchGrokModels(
  accessToken: string,
  options: GrokOAuthOptions = {},
): Promise<string[]> {
  const response = await (options.fetch ?? fetch)(
    `${(options.apiBaseUrl ?? GROK_API_BASE_URL).replace(/\/$/, "")}/models`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": options.userAgent?.trim() || "autopr/0.0.0",
      },
    },
  );
  const body = await readJsonRecord(response);
  if (!response.ok) {
    throw endpointError("xAI model discovery", response.status, body);
  }

  const models = Array.isArray(body.data) ? body.data : [];
  return normalizeGrokHarnessModels(models.flatMap((model) => {
    if (typeof model !== "object" || model === null || !("id" in model)) return [];
    const id = optionalString(model.id);
    return id ? [id] : [];
  }));
}

export function normalizeGrokHarnessModels(models: readonly string[]) {
  return [...new Set(models
    .map((model) => model.trim())
    .filter((model) =>
      model.length > 0
      && model.startsWith("grok-")
      && !model.startsWith("grok-imagine-")
      && !model.includes("multi-agent"),
    ))];
}

export function grokAccessTokenIsExpiring(
  token: string | undefined,
  skewMs = 120_000,
): boolean {
  if (!token) return false;
  const payload = token.split(".")[1];
  if (!payload) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof claims.exp === "number" && claims.exp * 1000 <= Date.now() + Math.max(0, skewMs);
  } catch {
    return false;
  }
}

export function decodeGrokIdentity(token: string | undefined) {
  if (!token) return {};
  const payload = token.split(".")[1];
  if (!payload) return {};

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return {
      email: optionalString(claims.email),
      name: optionalString(claims.name),
      subject: optionalString(claims.sub),
    };
  } catch {
    return {};
  }
}

function authHeaders(userAgent: string | undefined) {
  return {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": userAgent?.trim() || "autopr/0.0.0",
  };
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

function parseTokens(body: Record<string, unknown>, now: number, fallbackRefreshToken?: string): GrokOAuthTokens {
  return {
    accessToken: requireString(body.access_token, "access_token"),
    refreshToken: optionalString(body.refresh_token) ?? fallbackRefreshToken ?? requireString(body.refresh_token, "refresh_token"),
    expiresAt: now + positiveNumber(body.expires_in, 3600) * 1000,
    idToken: optionalString(body.id_token),
    scope: optionalString(body.scope),
    tokenType: optionalString(body.token_type),
  };
}

function endpointError(label: string, status: number, body: Record<string, unknown>) {
  const code = optionalString(body.error);
  const detail = optionalString(body.error_description) ?? optionalString(body.message) ?? code;
  return new GrokOAuthError(`${label} failed (${status})${detail ? `: ${detail}` : ""}`, status, code);
}

function requireString(value: unknown, field: string) {
  const result = optionalString(value);
  if (!result) throw new GrokOAuthError(`xAI response is missing ${field}.`, 502);
  return result;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
