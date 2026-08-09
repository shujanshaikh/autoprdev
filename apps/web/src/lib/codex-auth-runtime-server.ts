import { createChatGPTProxyProvider } from "@autopr/chatgpt/ai";
import {
  createChatGPTHandler,
  type KeyValueStore,
  type KeyValueStoreUpdate,
  type RateLimitBucket,
  type StoredSession,
} from "@autopr/chatgpt/server";
import { WorkOS } from "@workos-inc/node";
import { nanoid } from "nanoid";

export const CODEX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_RESPONSES_RATE_LIMIT = 30;
const DEFAULT_RESPONSES_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_CODEX_CLIENT_VERSION = "0.144.0";

export type CodexResponsesModel = ReturnType<
  ReturnType<typeof createChatGPTProxyProvider>["responses"]
>;

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
  deleteObject(input: { id: string; versionCheck?: string }): Promise<void>;
};

type VaultStoreEnvelope<T> = {
  value?: T;
  expiresAt?: number;
  consumedAt?: number;
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

export class WorkOSVaultStore<T> implements KeyValueStore<T> {
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
      try {
        await getWorkOSVault().deleteObject({
          id: object.id,
          versionCheck: object.metadata?.versionId,
        });
        return undefined;
      } catch (error) {
        if (isMissingVaultObject(error)) return undefined;
        if (isVaultConflict(error)) return this.get(key);
        throw error;
      }
    }

    return envelope.value;
  }

  async set(key: string, value: T, options: { ttlMs?: number } = {}): Promise<void> {
    await this.update(key, () => ({ value, ttlMs: options.ttlMs }));
  }

  async update(
    key: string,
    updater: (current: T | undefined) => KeyValueStoreUpdate<T>,
  ): Promise<T> {
    const name = vaultObjectName(this.scope, key);
    const vault = getWorkOSVault();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const existing = await vault.readObjectByName(name).catch((error: unknown) => {
        if (isMissingVaultObject(error)) return undefined;
        throw error;
      });
      const currentEnvelope = existing?.value
        ? JSON.parse(existing.value) as VaultStoreEnvelope<T>
        : undefined;
      const current = currentEnvelope?.expiresAt !== undefined && currentEnvelope.expiresAt <= Date.now()
        ? undefined
        : currentEnvelope?.value;
      const next = updater(current);
      const serialized = JSON.stringify({
        value: next.value,
        expiresAt: next.ttlMs === undefined ? undefined : Date.now() + next.ttlMs,
      } satisfies VaultStoreEnvelope<T>);

      try {
        if (existing) {
          await vault.updateObject({
            id: existing.id,
            value: serialized,
            versionCheck: existing.metadata?.versionId,
          });
        } else {
          await vault.createObject({
            name,
            value: serialized,
            context: {
              app: "autopr",
              purpose: "login-with-chatgpt",
              scope: this.scope,
            },
          });
        }
        return next.value;
      } catch (error) {
        const retryable = isVaultConflict(error) || isMissingVaultObject(error);
        if (!retryable || attempt === 3) throw error;
      }
    }

    throw new Error("WorkOS Vault atomic update exhausted its retry budget.");
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

  async take(key: string): Promise<T | undefined> {
    const name = vaultObjectName(this.scope, key);
    const vault = getWorkOSVault();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const object = await vault.readObjectByName(name).catch((error: unknown) => {
        if (isMissingVaultObject(error)) return undefined;
        throw error;
      });
      if (!object?.value) return undefined;
      const envelope = JSON.parse(object.value) as VaultStoreEnvelope<T>;
      if (envelope.value === undefined || envelope.expiresAt !== undefined && envelope.expiresAt <= Date.now()) {
        await vault.deleteObject({ id: object.id }).catch(() => undefined);
        return undefined;
      }

      try {
        await vault.updateObject({
          id: object.id,
          value: JSON.stringify({ consumedAt: Date.now() } satisfies VaultStoreEnvelope<T>),
          versionCheck: object.metadata?.versionId,
        });
        await vault.deleteObject({ id: object.id }).catch(() => undefined);
        return envelope.value;
      } catch (error) {
        if (isMissingVaultObject(error)) return undefined;
        if (!isVaultConflict(error) || attempt === 2) throw error;
      }
    }

    return undefined;
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
      store: new WorkOSVaultStore<RateLimitBucket>("responses-rate"),
    },
  },
});

function authRequestFromCookieHeader(cookieHeader: string) {
  return new Request("http://autopr.local/api/chatgpt/session", {
    headers: { cookie: cookieHeader },
  });
}

/**
 * Trigger.dev retains run payloads and session metadata, so the ChatGPT
 * session cookie must never be placed on a task payload. Instead the web
 * server stores the cookie in a short-lived Vault grant and only the opaque
 * grant id travels to Trigger; the worker redeems it here, inside the run.
 * The TTL covers Trigger's maximum run lifecycle (see AGENT_IDEMPOTENCY_KEY_TTL).
 * Grants are atomically consumed and deleted on redemption, explicitly revoked
 * after task completion or failed startup, and stale grants are deleted if read.
 */
export const CODEX_AGENT_GRANT_TTL_MS = 2 * 60 * 60 * 1000;

export type CodexAgentGrant = {
  userId: string;
  taskId: "autopr-agent" | "autopr-chat-agent";
  contextId: string;
  sessionCookieHeader: string;
};

const codexAgentGrantStore = new WorkOSVaultStore<CodexAgentGrant>("agent-codex-grant");

export async function createCodexAgentGrant(grant: CodexAgentGrant): Promise<string> {
  const grantId = nanoid(32);
  await codexAgentGrantStore.set(grantId, grant, { ttlMs: CODEX_AGENT_GRANT_TTL_MS });
  return grantId;
}

export function revokeCodexAgentGrant(grantId: string): Promise<void> {
  return codexAgentGrantStore.delete(grantId);
}

export async function resolveCodexAgentGrant(
  grantId: string,
  expected: Pick<CodexAgentGrant, "userId" | "taskId" | "contextId">,
): Promise<CodexAgentGrant> {
  const grant = await codexAgentGrantStore.take(grantId);
  if (!grant) {
    throw new CodexConnectionError(
      "Codex credentials for this run are missing or expired. Send the message again to start a fresh run.",
      401,
    );
  }

  if (
    grant.userId !== expected.userId ||
    grant.taskId !== expected.taskId ||
    grant.contextId !== expected.contextId
  ) {
    throw new CodexConnectionError(
      "Codex credentials do not match this agent run. Send the message again to start a fresh run.",
      401,
    );
  }

  return grant;
}

export type CodexResponsesModelCredentials =
  | { chatgptCookieHeader: string; credentialsGrantId?: never }
  | {
      credentialsGrantId: string;
      credentialsGrantContext: Pick<CodexAgentGrant, "userId" | "taskId" | "contextId">;
      chatgptCookieHeader?: never;
    };

export async function createCodexResponsesModel(options: {
  modelId: string;
  reasoningEffort: string;
} & CodexResponsesModelCredentials): Promise<CodexResponsesModel> {
  // Resolve the session cookie lazily and cache it per model instance: a grant
  // is redeemed at most once per turn, and token refreshes within the turn
  // reuse the cached cookie instead of extra Vault reads.
  let cookieHeaderPromise: Promise<string> | undefined;
  const resolveCookieHeader = () => {
    if (!cookieHeaderPromise) {
      const pending = (async () => {
        if (typeof options.chatgptCookieHeader === "string") {
          return options.chatgptCookieHeader;
        }

        return (await resolveCodexAgentGrant(
          options.credentialsGrantId,
          options.credentialsGrantContext,
        )).sessionCookieHeader;
      })();
      cookieHeaderPromise = pending;
      // Do not cache failures: a transient Vault error should not poison the
      // whole model instance.
      pending.catch(() => {
        if (cookieHeaderPromise === pending) {
          cookieHeaderPromise = undefined;
        }
      });
    }

    return cookieHeaderPromise;
  };

  let sessionProxyFetchPromise: Promise<typeof fetch> | undefined;
  const resolveSessionProxyFetch = () => {
    if (!sessionProxyFetchPromise) {
      const pending = resolveCookieHeader().then((cookieHeader) =>
        chatGPTAuth.proxyFetch(authRequestFromCookieHeader(cookieHeader)),
      );
      sessionProxyFetchPromise = pending;
      pending.catch(() => {
        if (sessionProxyFetchPromise === pending) {
          sessionProxyFetchPromise = undefined;
        }
      });
    }

    return sessionProxyFetchPromise;
  };

  const proxyFetch = (async (input, init) =>
    (await resolveSessionProxyFetch())(input, init)) as typeof fetch;

  const chatgpt = createChatGPTProxyProvider({
    basePath: chatGPTAuth.basePath,
    defaultModel: options.modelId,
    fetch: proxyFetch,
    headers: {
      "x-login-with-chatgpt-reasoning-effort": options.reasoningEffort,
    },
  });

  return chatgpt.responses(options.modelId);
}
