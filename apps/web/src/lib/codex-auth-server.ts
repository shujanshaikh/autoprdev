import "@tanstack/react-start/server-only";

import { api } from "@autopr/backend/convex/_generated/api";
import { WorkOS } from "@workos-inc/node";

import { convexMutation, convexQuery } from "#/lib/convex-server";
import { requireWorkOSAuth } from "#/lib/github-oauth-server";

const OPENAI_AUTH_ISSUER = "https://auth.openai.com";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_VERIFICATION_URL = `${OPENAI_AUTH_ISSUER}/codex/device`;
const SECURITY_SETTINGS_URL = "https://chatgpt.com/#settings/Security";
const POLLING_SAFETY_MARGIN_MS = 3_000;

type WorkOSVaultObject = {
  id: string;
  metadata?: {
    versionId?: string;
  };
};

export type WorkOSVault = {
  createObject(input: {
    name: string;
    value: string;
    context: { organizationId: string };
  }): Promise<WorkOSVaultObject>;
  updateObject(input: {
    id: string;
    value: string;
    versionCheck?: string;
  }): Promise<WorkOSVaultObject>;
  readObject(input: { id: string }): Promise<WorkOSVaultObject & { value: string }>;
  deleteObject(input: { id: string }): Promise<void>;
};

type DeviceCodeResponse = {
  device_auth_id: string;
  user_code: string;
  interval: string;
};

type DeviceTokenResponse = {
  authorization_code: string;
  code_verifier: string;
};

type CodexTokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

export type StoredCodexCredential = {
  provider: "openai-codex";
  type: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
  email?: string;
};

type CodexTokenClaims = {
  email?: string;
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
};

export class CodexConnectionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "CodexConnectionError";
  }
}

export function getWorkOSVault() {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new CodexConnectionError("WorkOS Vault is not configured. Set WORKOS_API_KEY.", 500);
  }

  return new WorkOS(apiKey).vault as WorkOSVault;
}

function parseJwtClaims(token: string | undefined): CodexTokenClaims | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as CodexTokenClaims;
  } catch {
    return undefined;
  }
}

function extractAccountId(claims: CodexTokenClaims | undefined) {
  return (
    claims?.chatgpt_account_id ??
    claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims?.organizations?.[0]?.id
  );
}

function normalizeCodexModel(model: string | undefined) {
  const selectedModel = model?.trim() || process.env.CODEX_MODEL || "gpt-5.5";
  const supportedModels = new Set([
    "gpt-5.5",
    "gpt-5.2-codex",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5-codex",
  ]);

  if (!supportedModels.has(selectedModel)) {
    throw new CodexConnectionError("Select a supported Codex model.", 400);
  }

  return selectedModel;
}

function codexVaultObjectName(userId: string) {
  return `autopr-codex-${userId}`;
}

async function fetchJson<T>(url: string, init: RequestInit, errorMessage: string) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new CodexConnectionError(errorMessage, response.status);
  }

  return (await response.json()) as T;
}

export function parseStoredCodexCredential(value: string): StoredCodexCredential {
  const parsed = JSON.parse(value) as Partial<StoredCodexCredential>;

  if (
    parsed.provider !== "openai-codex" ||
    parsed.type !== "oauth" ||
    !parsed.accessToken ||
    !parsed.refreshToken ||
    typeof parsed.expiresAt !== "number"
  ) {
    throw new CodexConnectionError("Stored Codex credentials are invalid. Reconnect Codex.", 401);
  }

  return parsed as StoredCodexCredential;
}

async function refreshCodexTokens(refreshToken: string) {
  return await fetchJson<CodexTokenResponse>(
    `${OPENAI_AUTH_ISSUER}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CODEX_CLIENT_ID,
      }).toString(),
    },
    "Could not refresh Codex credentials. Reconnect Codex.",
  );
}

export async function requireCodexAuthContext() {
  const authState = await requireWorkOSAuth();

  if (!authState.organizationId) {
    throw new CodexConnectionError(
      "Your WorkOS session does not include an organization. Create or select an organization before connecting Codex.",
      401,
    );
  }

  return {
    userId: authState.user.id,
    organizationId: authState.organizationId,
  };
}

export async function getCodexConnectionStatus() {
  return await convexQuery(api.codexAuth.status, {});
}

export async function getCodexAgentModelConfig(model?: string) {
  await requireCodexAuthContext();
  const status = await convexQuery(api.codexAuth.status, {});

  if (!status.connected) {
    throw new CodexConnectionError("Connect Codex before starting an AI stream.", 401);
  }

  const reference = await convexQuery(api.codexAuth.getVaultReference, {});
  const vaultObject = await getWorkOSVault().readObject({ id: reference.vaultObjectId });
  let credential = parseStoredCodexCredential(vaultObject.value);
  const modelId = normalizeCodexModel(model);

  if (credential.expiresAt <= Date.now() + 60_000) {
    const tokens = await refreshCodexTokens(credential.refreshToken);
    const claims = parseJwtClaims(tokens.id_token) ?? parseJwtClaims(tokens.access_token);
    credential = {
      provider: "openai-codex",
      type: "oauth",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountId: extractAccountId(claims) ?? credential.accountId,
      email: claims?.email ?? credential.email,
    };

    const updatedObject = await getWorkOSVault().updateObject({
      id: reference.vaultObjectId,
      value: JSON.stringify(credential),
      versionCheck: reference.vaultVersionId,
    });

    await convexMutation(api.codexAuth.upsert, {
      organizationId: reference.organizationId,
      vaultObjectId: updatedObject.id,
      vaultVersionId: updatedObject.metadata?.versionId,
      accountId: credential.accountId,
      email: credential.email,
      expiresAt: credential.expiresAt,
    });
  }

  return {
    provider: "openai-codex" as const,
    modelId,
    vaultObjectId: reference.vaultObjectId,
    vaultVersionId: reference.vaultVersionId,
    accountId: credential.accountId,
    expiresAt: credential.expiresAt,
  };
}

export async function startCodexDeviceAuthorization() {
  await requireCodexAuthContext();

  const device = await fetchJson<DeviceCodeResponse>(
    `${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/usercode`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "autopr/codex-auth",
      },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    },
    "Could not start Codex device authorization.",
  );

  return {
    userCode: device.user_code,
    deviceAuthId: device.device_auth_id,
    intervalMs: Math.max(Number.parseInt(device.interval, 10) || 5, 1) * 1000 + POLLING_SAFETY_MARGIN_MS,
    verificationUrl: CODEX_VERIFICATION_URL,
    securitySettingsUrl: SECURITY_SETTINGS_URL,
  };
}

export async function completeCodexDeviceAuthorization(deviceAuthId: string, userCode: string) {
  const { userId, organizationId } = await requireCodexAuthContext();

  const deviceTokenResponse = await fetch(`${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "autopr/codex-auth",
    },
    body: JSON.stringify({
      device_auth_id: deviceAuthId,
      user_code: userCode,
    }),
  });

  if (deviceTokenResponse.status === 403 || deviceTokenResponse.status === 404) {
    return { connected: false as const, pending: true as const };
  }

  if (!deviceTokenResponse.ok) {
    throw new CodexConnectionError("Codex authorization failed.", deviceTokenResponse.status);
  }

  const deviceToken = (await deviceTokenResponse.json()) as DeviceTokenResponse;
  const tokens = await fetchJson<CodexTokenResponse>(
    `${OPENAI_AUTH_ISSUER}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: deviceToken.authorization_code,
        redirect_uri: `${OPENAI_AUTH_ISSUER}/deviceauth/callback`,
        client_id: CODEX_CLIENT_ID,
        code_verifier: deviceToken.code_verifier,
      }).toString(),
    },
    "Could not exchange Codex authorization for tokens.",
  );

  const claims = parseJwtClaims(tokens.id_token) ?? parseJwtClaims(tokens.access_token);
  const value = JSON.stringify({
    provider: "openai-codex",
    type: "oauth",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId: extractAccountId(claims),
    email: claims?.email,
  });
  const status = await convexQuery(api.codexAuth.status, {});
  const existing = status.connected
    ? await convexQuery(api.codexAuth.getVaultReference, {})
    : undefined;

  const vaultObject = existing
    ? await getWorkOSVault().updateObject({
        id: existing.vaultObjectId,
        value,
        versionCheck: existing.vaultVersionId,
      })
    : await getWorkOSVault().createObject({
        name: codexVaultObjectName(userId),
        value,
        context: { organizationId },
      });

  const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
  await convexMutation(api.codexAuth.upsert, {
    organizationId,
    vaultObjectId: vaultObject.id,
    vaultVersionId: vaultObject.metadata?.versionId,
    accountId: extractAccountId(claims),
    email: claims?.email,
    expiresAt,
  });

  return { connected: true as const };
}

export async function disconnectCodex() {
  await requireCodexAuthContext();
  const status = await convexQuery(api.codexAuth.status, {});

  if (status.connected) {
    const existing = await convexQuery(api.codexAuth.getVaultReference, {});
    await getWorkOSVault().deleteObject({ id: existing.vaultObjectId });
    await convexMutation(api.codexAuth.remove, {});
  }

  return { disconnected: true as const };
}

export function codexErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CodexConnectionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
