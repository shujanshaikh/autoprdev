import "@tanstack/react-start/server-only";

import { decodeGrokIdentity, fetchGrokModels, GROK_FALLBACK_MODELS, grokAccessTokenIsExpiring, pollGrokDeviceToken, refreshGrokTokens, requestGrokDeviceCode, type GrokOAuthTokens } from "@autopr/grok/core";
import { createGrokOAuthProvider, type GrokResponsesModel } from "@autopr/grok/ai";
import { nanoid } from "nanoid";

import { isAgentReasoningEffortSupported } from "#/lib/agent-models";
import { WorkOSVaultStore } from "#/lib/codex-auth-runtime-server";

const TOKEN_REFRESH_SKEW_MS = 120_000;
const REFRESH_LEASE_MS = 30_000;
const DEVICE_FLOW_TTL_LIMIT_MS = 15 * 60 * 1000;
const GROK_AGENT_GRANT_TTL_MS = 2 * 60 * 60 * 1000;
const GROK_MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

export type GrokStoredCredentials = GrokOAuthTokens & {
  refreshLease?: { id: string; expiresAt: number };
  models?: string[];
  modelsUpdatedAt?: number;
};

export type GrokDeviceFlow = {
  userId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
};

export type GrokAgentGrant = {
  userId: string;
  taskId: "autopr-agent" | "autopr-chat-agent";
  contextId: string;
};

export type GrokAgentGrantContext = Pick<GrokAgentGrant, "userId" | "taskId" | "contextId">;

const credentialsStore = new WorkOSVaultStore<GrokStoredCredentials>("grok-account");
const deviceFlowStore = new WorkOSVaultStore<GrokDeviceFlow>("grok-device-flow");
const agentGrantStore = new WorkOSVaultStore<GrokAgentGrant>("agent-grok-grant");
const refreshPromises = new Map<string, Promise<GrokStoredCredentials>>();

type GrokStore<T> = Pick<WorkOSVaultStore<T>, "delete" | "get" | "set" | "take" | "update">;

export interface GrokAuthDependencies {
  credentialsStore: GrokStore<GrokStoredCredentials>;
  deviceFlowStore: GrokStore<GrokDeviceFlow>;
  fetchModels: typeof fetchGrokModels;
  pollDeviceToken: typeof pollGrokDeviceToken;
  refreshPromises: Map<string, Promise<GrokStoredCredentials>>;
  refreshTokens: typeof refreshGrokTokens;
  requestDeviceCode: typeof requestGrokDeviceCode;
}

const defaultDependencies: GrokAuthDependencies = {
  credentialsStore,
  deviceFlowStore,
  fetchModels: fetchGrokModels,
  pollDeviceToken: pollGrokDeviceToken,
  refreshPromises,
  refreshTokens: refreshGrokTokens,
  requestDeviceCode: requestGrokDeviceCode,
};

export class GrokConnectionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "GrokConnectionError";
  }
}

export async function startGrokDeviceAuthorization(
  userId: string,
  dependencies: GrokAuthDependencies = defaultDependencies,
) {
  const device = await dependencies.requestDeviceCode({ referrer: "autopr" });
  const flowId = nanoid(32);
  const now = Date.now();
  const expiresInMs = Math.min(device.expiresInSeconds * 1000, DEVICE_FLOW_TTL_LIMIT_MS);
  const flow: GrokDeviceFlow = {
    userId,
    deviceCode: device.deviceCode,
    userCode: device.userCode,
    verificationUri: device.verificationUri,
    verificationUriComplete: device.verificationUriComplete,
    expiresAt: now + expiresInMs,
    intervalMs: Math.max(1_000, device.intervalSeconds * 1000),
    nextPollAt: now,
  };
  await dependencies.deviceFlowStore.set(flowId, flow, { ttlMs: expiresInMs });

  return {
    flowId,
    userCode: flow.userCode,
    verificationUrl: flow.verificationUriComplete ?? flow.verificationUri,
    verificationUri: flow.verificationUri,
    expiresAt: flow.expiresAt,
    intervalMs: flow.intervalMs,
  };
}

export async function pollGrokDeviceAuthorization(
  userId: string,
  flowId: string,
  dependencies: GrokAuthDependencies = defaultDependencies,
) {
  const flow = await dependencies.deviceFlowStore.get(flowId);
  if (!flow || flow.userId !== userId) {
    throw new GrokConnectionError("This Grok connection request is missing or expired.", 404);
  }
  if (flow.expiresAt <= Date.now()) {
    await dependencies.deviceFlowStore.delete(flowId);
    return { status: "expired" as const };
  }

  const reserved = await dependencies.deviceFlowStore.update(flowId, (current) => {
    if (!current || current.userId !== userId) {
      throw new GrokConnectionError("This Grok connection request is missing or expired.", 404);
    }
    if (current.nextPollAt > Date.now()) {
      throw new GrokConnectionError("Grok authorization is still pending.", 429);
    }
    return {
      value: { ...current, nextPollAt: Date.now() + current.intervalMs },
      ttlMs: Math.max(1_000, current.expiresAt - Date.now()),
    };
  });
  const result = await dependencies.pollDeviceToken(reserved.deviceCode);

  if (result.status === "success") {
    await dependencies.credentialsStore.set(userId, result.tokens);
    await dependencies.deviceFlowStore.delete(flowId);
    return { status: "connected" as const };
  }
  if (result.status === "denied" || result.status === "expired") {
    await dependencies.deviceFlowStore.delete(flowId);
    return { status: result.status };
  }

  const intervalMs = result.slowDown ? reserved.intervalMs + 5_000 : reserved.intervalMs;
  await dependencies.deviceFlowStore.update(flowId, (current) => ({
    value: {
      ...(current ?? reserved),
      intervalMs,
      nextPollAt: Date.now() + intervalMs,
    },
    ttlMs: Math.max(1_000, reserved.expiresAt - Date.now()),
  }));
  return { status: "pending" as const, intervalMs };
}

export async function getGrokConnectionStatus(
  userId: string,
  dependencies: GrokAuthDependencies = defaultDependencies,
) {
  const credentials = await dependencies.credentialsStore.get(userId);
  if (!credentials) return { connected: false as const };
  const fresh = await getFreshGrokCredentials(userId, credentials, dependencies);
  const models = await getAvailableGrokModels(userId, fresh, dependencies);
  const identity = decodeGrokIdentity(fresh.idToken ?? fresh.accessToken);
  return {
    connected: true as const,
    ...identity,
    models,
    expiresAt: fresh.expiresAt,
  };
}

export async function disconnectGrok(
  userId: string,
  dependencies: GrokAuthDependencies = defaultDependencies,
) {
  await dependencies.credentialsStore.delete(userId);
}

export async function createGrokAgentGrant(grant: GrokAgentGrant) {
  const grantId = nanoid(32);
  await agentGrantStore.set(grantId, grant, { ttlMs: GROK_AGENT_GRANT_TTL_MS });
  return grantId;
}

export function revokeGrokAgentGrant(grantId: string) {
  return agentGrantStore.delete(grantId);
}

export async function resolveGrokAgentGrant(grantId: string, expected: GrokAgentGrantContext) {
  const grant = await agentGrantStore.take(grantId);
  if (!grant) {
    throw new GrokConnectionError(
      "Grok credentials for this run are missing or expired. Send the message again to start a fresh run.",
      401,
    );
  }
  if (grant.userId !== expected.userId || grant.taskId !== expected.taskId || grant.contextId !== expected.contextId) {
    throw new GrokConnectionError("Grok credentials do not match this agent run.", 401);
  }
  return grant;
}

export async function createGrokResponsesModel(options: {
  modelId: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  promptCacheKey?: string;
  credentialsGrantId: string;
  credentialsGrantContext: GrokAgentGrantContext;
}): Promise<GrokResponsesModel> {
  const reasoningEffort = isAgentReasoningEffortSupported(
    { provider: "xai", modelId: options.modelId },
    options.reasoningEffort,
  ) ? options.reasoningEffort : undefined;
  let userIdPromise: Promise<string> | undefined;
  const resolveUserId = () => {
    userIdPromise ??= resolveGrokAgentGrant(
      options.credentialsGrantId,
      options.credentialsGrantContext,
    ).then((grant) => grant.userId);
    userIdPromise.catch(() => {
      userIdPromise = undefined;
    });
    return userIdPromise;
  };
  const provider = createGrokOAuthProvider({
    accessToken: async () => (await getFreshGrokCredentials(await resolveUserId())).accessToken,
    promptCacheKey: options.promptCacheKey,
    reasoningEffort: reasoningEffort === "xhigh" ? "xhigh" : undefined,
  });
  return provider.responses(options.modelId);
}

async function getFreshGrokCredentials(
  userId: string,
  loaded?: GrokStoredCredentials,
  dependencies: GrokAuthDependencies = defaultDependencies,
): Promise<GrokStoredCredentials> {
  const current = loaded ?? await dependencies.credentialsStore.get(userId);
  if (!current) throw new GrokConnectionError("Connect Grok before starting an AI stream.", 401);
  const expiresSoon = current.expiresAt <= Date.now() + TOKEN_REFRESH_SKEW_MS
    || grokAccessTokenIsExpiring(current.accessToken, TOKEN_REFRESH_SKEW_MS);
  if (!expiresSoon) return current;

  const existingRefresh = dependencies.refreshPromises.get(userId);
  if (existingRefresh) return existingRefresh;
  const refresh = refreshGrokCredentialsWithLease(userId, dependencies)
    .finally(() => {
      if (dependencies.refreshPromises.get(userId) === refresh) dependencies.refreshPromises.delete(userId);
    });
  dependencies.refreshPromises.set(userId, refresh);
  return refresh;
}

async function refreshGrokCredentialsWithLease(userId: string, dependencies: GrokAuthDependencies): Promise<GrokStoredCredentials> {
  const leaseId = nanoid(16);
  const leased = await dependencies.credentialsStore.update(userId, (latest) => {
    if (!latest) throw new GrokConnectionError("Connect Grok before starting an AI stream.", 401);
    const alreadyFresh = latest.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS
      && !grokAccessTokenIsExpiring(latest.accessToken, TOKEN_REFRESH_SKEW_MS);
    if (alreadyFresh) return { value: latest };
    if (latest.refreshLease && latest.refreshLease.expiresAt > Date.now()) return { value: latest };
    return { value: { ...latest, refreshLease: { id: leaseId, expiresAt: Date.now() + REFRESH_LEASE_MS } } };
  });
  if (!leased.refreshLease) return leased;
  if (leased.refreshLease.id !== leaseId) {
    return waitForGrokCredentialRefresh(userId, leased.refreshLease.expiresAt, dependencies);
  }

  try {
    const refreshed = await dependencies.refreshTokens(leased.refreshToken);
    const completeRefresh = {
      ...refreshed,
      idToken: refreshed.idToken ?? leased.idToken,
      scope: refreshed.scope ?? leased.scope,
      tokenType: refreshed.tokenType ?? leased.tokenType,
      models: leased.models,
      modelsUpdatedAt: leased.modelsUpdatedAt,
    };
    return await dependencies.credentialsStore.update(userId, (latest) => {
      if (!latest) {
        throw new GrokConnectionError("Grok was disconnected while refreshing credentials.", 401);
      }

      return {
        value: latest.refreshLease?.id === leaseId
          ? completeRefresh
          : latest,
      };
    });
  } catch (error) {
    await dependencies.credentialsStore.update(userId, (latest) => {
      if (!latest) {
        throw new GrokConnectionError("Grok was disconnected while refreshing credentials.", 401);
      }

      return {
        value: latest.refreshLease?.id === leaseId
          ? { ...latest, refreshLease: undefined }
          : latest,
      };
    }).catch(() => undefined);
    throw error;
  }
}

async function getAvailableGrokModels(userId: string, credentials: GrokStoredCredentials, dependencies: GrokAuthDependencies) {
  const cachedModels = credentials.models?.length ? credentials.models : undefined;
  if (cachedModels && (credentials.modelsUpdatedAt ?? 0) > Date.now() - GROK_MODEL_CACHE_TTL_MS) {
    return cachedModels;
  }

  const discovered = await dependencies.fetchModels(credentials.accessToken).catch(() => undefined);
  const models = discovered?.length
    ? discovered
    : cachedModels ?? [...GROK_FALLBACK_MODELS];
  await dependencies.credentialsStore.update(userId, (latest) => {
    if (!latest) {
      throw new GrokConnectionError("Grok was disconnected while loading models.", 401);
    }

    return {
      value: {
        ...latest,
        models,
        modelsUpdatedAt: Date.now(),
      },
    };
  }).catch(() => undefined);
  return models;
}

async function waitForGrokCredentialRefresh(userId: string, leaseExpiresAt: number, dependencies: GrokAuthDependencies) {
  while (Date.now() < leaseExpiresAt) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    const current = await dependencies.credentialsStore.get(userId);
    if (!current) throw new GrokConnectionError("Connect Grok before starting an AI stream.", 401);
    if (!current.refreshLease) {
      const fresh = current.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS
        && !grokAccessTokenIsExpiring(current.accessToken, TOKEN_REFRESH_SKEW_MS);
      return fresh ? current : refreshGrokCredentialsWithLease(userId);
    }
  }
  return refreshGrokCredentialsWithLease(userId);
}
