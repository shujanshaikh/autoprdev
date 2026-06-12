import "@tanstack/react-start/server-only";

import { api } from "@autopr/backend/convex/_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { WorkOS } from "@workos-inc/node";

import { convexMutation, convexQuery } from "#/lib/convex-server";
import { DEFAULT_CODEX_REASONING_EFFORT, isCodexReasoningEffortForModel } from "#/lib/codex-models";
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

type CodexResponsesModel = ReturnType<ReturnType<typeof createOpenAI>["responses"]>;

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
  const supportedModels = new Set(["gpt-5.5"]);

  if (!supportedModels.has(selectedModel)) {
    throw new CodexConnectionError("Select a supported Codex model.", 400);
  }

  return selectedModel;
}

function normalizeCodexReasoningEffort(modelId: string, reasoningEffort: string | undefined) {
  const selectedReasoningEffort = reasoningEffort?.trim() || DEFAULT_CODEX_REASONING_EFFORT;

  if (!isCodexReasoningEffortForModel(modelId, selectedReasoningEffort)) {
    throw new CodexConnectionError("Select a supported reasoning level for this Codex model.", 400);
  }

  return selectedReasoningEffort;
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

async function readFreshCodexCredentialReference() {
  await requireCodexAuthContext();
  const status = await convexQuery(api.codexAuth.status, {});

  if (!status.connected) {
    throw new CodexConnectionError("Connect Codex before starting an AI stream.", 401);
  }

  const reference = await convexQuery(api.codexAuth.getVaultReference, {});
  const vaultObject = await getWorkOSVault().readObject({ id: reference.vaultObjectId });
  let credential = parseStoredCodexCredential(vaultObject.value);

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

  return { reference, credential };
}

function responseInputContentToText(content: unknown) {
  if (!Array.isArray(content)) {
    return typeof content === "string" ? content : "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function createCodexResponsesModelFromCredential(
  credential: StoredCodexCredential,
  options: {
    modelId: string;
    reasoningEffort: string;
    promptCacheKey?: string;
    accountId?: string;
  },
): CodexResponsesModel {
  if (credential.expiresAt <= Date.now()) {
    throw new CodexConnectionError("Codex credentials expired. Reconnect Codex and try again.", 401);
  }

  const provider = createOpenAI({
    apiKey: credential.accessToken,
    fetch: async (input, init) => {
      const requestUrl = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      const url = requestUrl.pathname.includes("/v1/responses") || requestUrl.pathname.includes("/chat/completions")
        ? new URL("https://chatgpt.com/backend-api/codex/responses")
        : requestUrl;

      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${credential.accessToken}`);
      const accountId = credential.accountId ?? options.accountId;
      if (accountId) {
        headers.set("ChatGPT-Account-Id", accountId);
      }

      const nextInit: RequestInit = { ...init, headers };
      if (typeof nextInit.body === "string" && nextInit.method === "POST") {
        const body = JSON.parse(nextInit.body) as {
          instructions?: string;
          input?: Array<Record<string, unknown>>;
          prompt_cache_key?: string;
          reasoning?: Record<string, unknown>;
          store?: boolean;
          stream?: boolean;
        };

        body.store = false;
        body.stream = true;
        body.prompt_cache_key = body.prompt_cache_key || options.promptCacheKey;
        body.reasoning = { ...body.reasoning, effort: options.reasoningEffort };

        if (Array.isArray(body.input)) {
          const instructions = body.input
            .filter((item) => item.role === "system" || item.role === "developer")
            .map((item) => responseInputContentToText(item.content))
            .filter(Boolean)
            .join("\n");

          body.input = body.input.filter((item) => item.type !== "item_reference");

          if (!body.instructions && instructions) {
            body.instructions = instructions;
            body.input = body.input.filter((item) => item.role !== "system" && item.role !== "developer");
          }
        }

        nextInit.body = JSON.stringify(body);
      }

      const response = await fetch(url, nextInit);
      if (!response.ok) {
        const errorBody = await response.clone().text().catch(() => "<failed to read response body>");
        throw new CodexConnectionError(
          `Codex API request failed: ${response.status} ${response.statusText} ${errorBody}`,
          response.status,
        );
      }

      return response;
    },
  });
  const responsesModel = provider.responses(options.modelId);

  const accountId = credential.accountId ?? options.accountId;
  if (accountId) {
    const originalDoStream = responsesModel.doStream.bind(responsesModel);
    responsesModel.doStream = (callOptions) =>
      originalDoStream({
        ...callOptions,
        headers: {
          ...callOptions.headers,
          "ChatGPT-Account-Id": accountId,
        },
      });
  }

  return responsesModel;
}

export async function createCodexResponsesModel(options: {
  vaultObjectId: string;
  modelId: string;
  reasoningEffort: string;
  promptCacheKey?: string;
  accountId?: string;
}): Promise<CodexResponsesModel> {
  const vaultObject = await getWorkOSVault().readObject({ id: options.vaultObjectId });
  const credential = parseStoredCodexCredential(vaultObject.value);

  return createCodexResponsesModelFromCredential(credential, options);
}

export async function createAuthenticatedCodexResponsesModel(options: {
  modelId: string;
  reasoningEffort: string;
  promptCacheKey?: string;
}): Promise<CodexResponsesModel> {
  const { credential } = await readFreshCodexCredentialReference();

  return createCodexResponsesModelFromCredential(credential, options);
}

export async function getCodexAgentModelConfig(model?: string, reasoningEffort?: string) {
  const { reference, credential } = await readFreshCodexCredentialReference();
  const modelId = normalizeCodexModel(model);
  const selectedReasoningEffort = normalizeCodexReasoningEffort(modelId, reasoningEffort);

  return {
    provider: "openai-codex" as const,
    modelId,
    reasoningEffort: selectedReasoningEffort,
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
