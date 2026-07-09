import "@tanstack/react-start/server-only";

import { createChatGPT, type CreateChatGPTOptions } from "@opencoredev/loginwithchatgpt-ai";
import {
  createChatGPTHandler,
  type KeyValueStore,
  type RateLimitBucket,
  type StoredSession,
} from "@opencoredev/loginwithchatgpt-server";
import { WorkOS } from "@workos-inc/node";

import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  isCodexReasoningEffortForModel,
  normalizeCodexModelId,
  normalizeCodexModelList,
  selectCodexModel,
} from "#/lib/codex-models";

export const CHATGPT_AUTH_BASE_PATH = "/api/chatgpt";

const CHATGPT_SESSION_COOKIE_NAME = "lwc_session";
const DEFAULT_CHATGPT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_RESPONSES_RATE_LIMIT = 30;
const DEFAULT_RESPONSES_RATE_WINDOW_MS = 60 * 1000;

type CodexResponsesModel = ReturnType<ReturnType<typeof createChatGPT>["responses"]>;

type WorkOSVaultObject = {
  id: string;
  value?: string;
};

type WorkOSVault = {
  createObject(input: {
    name: string;
    value: string;
    context: Record<string, string>;
  }): Promise<{ id: string }>;
  readObjectByName(name: string): Promise<WorkOSVaultObject>;
  updateObject(input: { id: string; value: string }): Promise<WorkOSVaultObject>;
  deleteObject(input: { id: string }): Promise<void>;
};

type VaultStoreEnvelope<T> = {
  value: T;
  expiresAt?: number;
};

export class CodexConnectionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "CodexConnectionError";
  }
}

function getWorkOSVault() {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new CodexConnectionError("WorkOS Vault is not configured. Set WORKOS_API_KEY.", 500);
  }

  return new WorkOS(apiKey).vault as WorkOSVault;
}

function getChatGPTSecret() {
  const secret = process.env.LWC_SECRET ?? process.env.LOGIN_WITH_CHATGPT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new CodexConnectionError("Login with ChatGPT is not configured. Set LWC_SECRET.", 500);
  }

  return secret;
}

function getAllowedOrigins() {
  return (process.env.LWC_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getAllowedModels() {
  const models = (process.env.LWC_ALLOWED_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length > 0 ? models : undefined;
}

function isResponseStatus(error: unknown, status: number) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}

function isMissingVaultObject(error: unknown) {
  return isResponseStatus(error, 404);
}

function isVaultConflict(error: unknown) {
  return isResponseStatus(error, 409);
}

function vaultObjectName(scope: string, key: string) {
  const encodedKey = Buffer.from(key).toString("base64url");
  return `autopr-lwc-${scope}-${encodedKey}`;
}

class WorkOSVaultStore<T> implements KeyValueStore<T> {
  constructor(private readonly scope: string) {}

  async get(key: string): Promise<T | undefined> {
    const name = vaultObjectName(this.scope, key);
    let object: WorkOSVaultObject;

    try {
      object = await getWorkOSVault().readObjectByName(name);
    } catch (error) {
      if (isMissingVaultObject(error)) {
        return undefined;
      }
      throw error;
    }

    if (!object.value) {
      return undefined;
    }

    const envelope = JSON.parse(object.value) as VaultStoreEnvelope<T>;
    if (envelope.expiresAt !== undefined && envelope.expiresAt <= Date.now()) {
      await getWorkOSVault().deleteObject({ id: object.id }).catch(() => undefined);
      return undefined;
    }

    return envelope.value;
  }

  async set(key: string, value: T, options: { ttlMs?: number } = {}): Promise<void> {
    const name = vaultObjectName(this.scope, key);
    const serialized = JSON.stringify({
      value,
      expiresAt: options.ttlMs === undefined ? undefined : Date.now() + options.ttlMs,
    } satisfies VaultStoreEnvelope<T>);

    const existing = await getWorkOSVault().readObjectByName(name).catch((error: unknown) => {
      if (isMissingVaultObject(error)) {
        return undefined;
      }
      throw error;
    });

    if (existing) {
      await getWorkOSVault().updateObject({ id: existing.id, value: serialized });
      return;
    }

    await getWorkOSVault()
      .createObject({
        name,
        value: serialized,
        context: {
          app: "autopr",
          purpose: "login-with-chatgpt",
          scope: this.scope,
        },
      })
      .catch(async (error: unknown) => {
        if (!isVaultConflict(error)) {
          throw error;
        }

        const latest = await getWorkOSVault().readObjectByName(name);
        await getWorkOSVault().updateObject({ id: latest.id, value: serialized });
      });
  }

  async delete(key: string): Promise<void> {
    const name = vaultObjectName(this.scope, key);
    const existing = await getWorkOSVault().readObjectByName(name).catch((error: unknown) => {
      if (isMissingVaultObject(error)) {
        return undefined;
      }
      throw error;
    });

    if (existing) {
      await getWorkOSVault().deleteObject({ id: existing.id });
    }
  }
}

export const chatGPTAuth = createChatGPTHandler({
  basePath: CHATGPT_AUTH_BASE_PATH,
  secret: getChatGPTSecret(),
  sessionStore: new WorkOSVaultStore<StoredSession>("session"),
  sessionTtlMs: DEFAULT_CHATGPT_SESSION_TTL_MS,
  allowedOrigins: getAllowedOrigins(),
  responsesProxy: {
    allowedModels: getAllowedModels(),
    rateLimit: {
      limit: Number.parseInt(process.env.LWC_RATE_LIMIT_PER_MINUTE ?? "", 10) || DEFAULT_RESPONSES_RATE_LIMIT,
      windowMs: DEFAULT_RESPONSES_RATE_WINDOW_MS,
      store: new WorkOSVaultStore<RateLimitBucket>("responses-rate"),
    },
  },
});

export function handleChatGPTAuthRequest(request: Request) {
  return chatGPTAuth.handler(request);
}

function authRequestFromCookieHeader(cookieHeader: string) {
  return new Request(`${new URL("http://autopr.local").origin}${CHATGPT_AUTH_BASE_PATH}/session`, {
    headers: { cookie: cookieHeader },
  });
}

function rewriteToChatGPTPath(request: Request, path: string, method = request.method) {
  const url = new URL(request.url);
  url.pathname = `${CHATGPT_AUTH_BASE_PATH}${path}`;
  url.search = "";

  return new Request(url, {
    method,
    headers: request.headers,
  });
}

export function getChatGPTSessionCookieHeader(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }

  const sessionCookie = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${CHATGPT_SESSION_COOKIE_NAME}=`));

  return sessionCookie;
}

function requireChatGPTSessionCookieHeader(request: Request) {
  const cookieHeader = getChatGPTSessionCookieHeader(request);
  if (!cookieHeader) {
    throw new CodexConnectionError("Connect Codex before starting an AI stream.", 401);
  }

  return cookieHeader;
}

async function getAvailableModels(request: Request) {
  const models = normalizeCodexModelList(await chatGPTAuth.getModels(request));
  if (!models || models.length === 0) {
    throw new CodexConnectionError("No ChatGPT models are available for this account.", 401);
  }

  return models;
}

function selectAvailableModel(requestedModel: string | undefined, availableModels: string[]) {
  const requested = normalizeCodexModelId(requestedModel);
  if (requested && availableModels.includes(requested)) {
    return requested;
  }

  if (requested && requested !== DEFAULT_CODEX_MODEL) {
    throw new CodexConnectionError("Selected ChatGPT model is not available for this account.", 400);
  }

  const fallback = selectCodexModel(availableModels);
  if (!fallback) {
    throw new CodexConnectionError("No ChatGPT models are available for this account.", 401);
  }

  return fallback;
}

function normalizeCodexReasoningEffort(modelId: string, reasoningEffort: string | undefined) {
  const selectedReasoningEffort = reasoningEffort?.trim() || DEFAULT_CODEX_REASONING_EFFORT;

  if (!isCodexReasoningEffortForModel(modelId, selectedReasoningEffort)) {
    throw new CodexConnectionError("Select a supported reasoning level for this ChatGPT model.", 400);
  }

  return selectedReasoningEffort;
}

export async function getCodexConnectionStatus(request: Request) {
  const session = await chatGPTAuth.getSession(request);

  if (session.status !== "authenticated") {
    return { connected: false as const };
  }

  const models = await chatGPTAuth.getModels(request)
    .then((availableModels) => normalizeCodexModelList(availableModels))
    .catch(() => undefined);

  return {
    connected: true as const,
    accountId: session.user?.accountId,
    email: session.user?.email,
    name: session.user?.name,
    plan: session.user?.plan,
    models,
  };
}

export async function disconnectCodex(request: Request) {
  return chatGPTAuth.handler(rewriteToChatGPTPath(request, "/logout", "POST"));
}

export async function createCodexResponsesModel(options: {
  chatgptCookieHeader: string;
  modelId: string;
  reasoningEffort: string;
}): Promise<CodexResponsesModel> {
  const authRequest = authRequestFromCookieHeader(options.chatgptCookieHeader);
  const chatgpt = createChatGPT({
    defaultModel: options.modelId,
    reasoningEffort: options.reasoningEffort as CreateChatGPTOptions["reasoningEffort"],
    reasoningSummary: "auto",
    credentials: async () => {
      const tokens = await chatGPTAuth.getTokens(authRequest);
      if (!tokens) {
        throw new CodexConnectionError("Connect Codex before starting an AI stream.", 401);
      }

      return tokens;
    },
  });

  return chatgpt.responses(options.modelId);
}

export async function createAuthenticatedCodexResponsesModel(options: {
  request: Request;
  modelId?: string;
  reasoningEffort?: string;
  disconnectedMessage?: string;
}): Promise<CodexResponsesModel> {
  try {
    const config = await getCodexAgentModelConfig(options.request, options.modelId, options.reasoningEffort);
    return createCodexResponsesModel(config);
  } catch (error) {
    if (error instanceof CodexConnectionError && options.disconnectedMessage && error.status === 401) {
      throw new CodexConnectionError(options.disconnectedMessage, error.status);
    }

    throw error;
  }
}

export async function getCodexAgentModelConfig(request: Request, model?: string, reasoningEffort?: string) {
  const chatgptCookieHeader = requireChatGPTSessionCookieHeader(request);
  const authRequest = authRequestFromCookieHeader(chatgptCookieHeader);
  const session = await chatGPTAuth.getSession(authRequest);

  if (session.status !== "authenticated") {
    throw new CodexConnectionError("Connect Codex before starting an AI stream.", 401);
  }

  const availableModels = await getAvailableModels(authRequest);
  const modelId = selectAvailableModel(model, availableModels);
  const selectedReasoningEffort = normalizeCodexReasoningEffort(modelId, reasoningEffort);

  return {
    provider: "openai-codex" as const,
    modelId,
    reasoningEffort: selectedReasoningEffort,
    chatgptCookieHeader,
  };
}

export function codexErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CodexConnectionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
