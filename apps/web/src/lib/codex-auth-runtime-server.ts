import { createChatGPT, type CreateChatGPTOptions } from "@opencoredev/loginwithchatgpt-ai";
import {
  createChatGPTHandler,
  type KeyValueStore,
  type RateLimitBucket,
  type StoredSession,
} from "@opencoredev/loginwithchatgpt-server";
import { WorkOS } from "@workos-inc/node";

import { mergeRateLimitBucket } from "#/lib/codex-rate-limit";

export const CODEX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_RESPONSES_RATE_LIMIT = 30;
const DEFAULT_RESPONSES_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_CODEX_CLIENT_VERSION = "0.144.0";

export type CodexResponsesModel = ReturnType<ReturnType<typeof createChatGPT>["responses"]>;

export type WorkOSVaultObject = {
  id: string;
  value?: string;
  metadata?: {
    versionId?: string;
  };
};

type WorkOSVault = {
  createObject(input: {
    name: string;
    value: string;
    context: Record<string, string>;
  }): Promise<WorkOSVaultObject>;
  readObject(input: { id: string }): Promise<WorkOSVaultObject>;
  readObjectByName(name: string): Promise<WorkOSVaultObject>;
  updateObject(input: {
    id: string;
    value: string;
    versionCheck?: string;
  }): Promise<WorkOSVaultObject>;
  deleteObject(input: { id: string }): Promise<void>;
};

type VaultStoreEnvelope<T> = {
  value: T;
  expiresAt?: number;
};

type VaultConflictMerge<T> = (latest: T, proposed: T) => T;

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

function getCodexClientVersion() {
  return process.env.LWC_CLIENT_VERSION?.trim() || DEFAULT_CODEX_CLIENT_VERSION;
}

function isResponseStatus(error: unknown, status: number) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}

export function isMissingVaultObject(error: unknown) {
  return isResponseStatus(error, 404);
}

export function isVaultConflict(error: unknown) {
  return isResponseStatus(error, 409);
}

export function vaultObjectName(scope: string, key: string) {
  const encodedKey = Buffer.from(key).toString("base64url");
  return `autopr-lwc-${scope}-${encodedKey}`;
}

class WorkOSVaultStore<T> implements KeyValueStore<T> {
  constructor(
    private readonly scope: string,
    private readonly mergeConflict?: VaultConflictMerge<T>,
  ) {}

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
    const expiresAt = options.ttlMs === undefined ? undefined : Date.now() + options.ttlMs;
    const serialize = (nextValue: T) => JSON.stringify({
      value: nextValue,
      expiresAt,
    } satisfies VaultStoreEnvelope<T>);
    const vault = getWorkOSVault();

    const existing = await vault.readObjectByName(name).catch((error: unknown) => {
      if (isMissingVaultObject(error)) {
        return undefined;
      }
      throw error;
    });

    if (existing) {
      let current = existing;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const currentEnvelope = current.value
          ? JSON.parse(current.value) as VaultStoreEnvelope<T>
          : undefined;
        const nextValue = this.mergeConflict && currentEnvelope
          ? this.mergeConflict(currentEnvelope.value, value)
          : value;
        try {
          await vault.updateObject({
            id: current.id,
            value: serialize(nextValue),
            versionCheck: current.metadata?.versionId,
          });
          return;
        } catch (error) {
          if (!isVaultConflict(error) || attempt === 2) throw error;
          current = await vault.readObjectByName(name);
        }
      }
      return;
    }

    await vault
      .createObject({
        name,
        value: serialize(value),
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

        let latest = await vault.readObjectByName(name);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const latestEnvelope = latest.value
            ? JSON.parse(latest.value) as VaultStoreEnvelope<T>
            : undefined;
          const nextValue = this.mergeConflict && latestEnvelope
            ? this.mergeConflict(latestEnvelope.value, value)
            : value;
          try {
            await vault.updateObject({
              id: latest.id,
              value: serialize(nextValue),
              versionCheck: latest.metadata?.versionId,
            });
            return;
          } catch (updateError) {
            if (!isVaultConflict(updateError) || attempt === 2) throw updateError;
            latest = await vault.readObjectByName(name);
          }
        }
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
  basePath: "/api/chatgpt",
  clientVersion: getCodexClientVersion(),
  secret: getChatGPTSecret(),
  sessionStore: new WorkOSVaultStore<StoredSession>("session"),
  sessionTtlMs: CODEX_SESSION_TTL_MS,
  allowedOrigins: getAllowedOrigins(),
  responsesProxy: {
    allowedModels: getAllowedModels(),
    rateLimit: {
      limit: Number.parseInt(process.env.LWC_RATE_LIMIT_PER_MINUTE ?? "", 10) || DEFAULT_RESPONSES_RATE_LIMIT,
      windowMs: DEFAULT_RESPONSES_RATE_WINDOW_MS,
      store: new WorkOSVaultStore<RateLimitBucket>("responses-rate", mergeRateLimitBucket),
    },
  },
});

function authRequestFromCookieHeader(cookieHeader: string) {
  return new Request("http://autopr.local/api/chatgpt/session", {
    headers: { cookie: cookieHeader },
  });
}

export async function createCodexResponsesModel(options: {
  chatgptCookieHeader: string;
  modelId: string;
  reasoningEffort: string;
}): Promise<CodexResponsesModel> {
  const authRequest = authRequestFromCookieHeader(options.chatgptCookieHeader);
  const chatgpt = createChatGPT({
    clientVersion: getCodexClientVersion(),
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
