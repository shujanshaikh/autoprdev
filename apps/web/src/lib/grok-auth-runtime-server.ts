import "@tanstack/react-start/server-only";

import {
  decodeGrokIdentity,
  fetchGrokModels,
  grokAccessTokenIsExpiring,
  pollGrokDeviceToken,
  refreshGrokTokens,
  requestGrokDeviceCode,
  type GrokOAuthTokens,
} from "@autopr/grok/core";
import { createGrokOAuthProvider, type GrokResponsesModel } from "@autopr/grok/ai";
import { nanoid } from "nanoid";

import { WorkOSVaultStore } from "#/lib/codex-auth-runtime-server";

const TOKEN_REFRESH_SKEW_MS = 120_000;
const REFRESH_LEASE_MS = 30_000;
const DEVICE_FLOW_TTL_LIMIT_MS = 15 * 60 * 1000;
const GROK_AGENT_GRANT_TTL_MS = 2 * 60 * 60 * 1000;

type GrokStoredCredentials = GrokOAuthTokens & {
  refreshLease?: { id: string; expiresAt: number };
};

type GrokDeviceFlow = {
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

export class GrokConnectionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "GrokConnectionError";
  }
}

export async function startGrokDeviceAuthorization(userId: string) {
  const device = await requestGrokDeviceCode({ referrer: "autopr" });
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
  await deviceFlowStore.set(flowId, flow, { ttlMs: expiresInMs });

  return {
    flowId,
    userCode: flow.userCode,
    verificationUrl: flow.verificationUriComplete ?? flow.verificationUri,
    verificationUri: flow.verificationUri,
    expiresAt: flow.expiresAt,
    intervalMs: flow.intervalMs,
  };
}

export async function pollGrokDeviceAuthorization(userId: string, flowId: string) {
  const flow = await deviceFlowStore.get(flowId);
  if (!flow || flow.userId !== userId) {
    throw new GrokConnectionError("This Grok connection request is missing or expired.", 404);
  }
  if (flow.expiresAt <= Date.now()) {
    await deviceFlowStore.delete(flowId);
    return { status: "expired" as const };
  }

  const reserved = await deviceFlowStore.update(flowId, (current) => {
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
  const result = await pollGrokDeviceToken(reserved.deviceCode);

  if (result.status === "success") {
    await Promise.all([
      credentialsStore.set(userId, result.tokens),
      deviceFlowStore.delete(flowId),
    ]);
    return { status: "connected" as const };
  }
  if (result.status === "denied" || result.status === "expired") {
    await deviceFlowStore.delete(flowId);
    return { status: result.status };
  }

  const intervalMs = result.slowDown ? reserved.intervalMs + 5_000 : reserved.intervalMs;
  await deviceFlowStore.update(flowId, (current) => ({
    value: {
      ...(current ?? reserved),
      intervalMs,
      nextPollAt: Date.now() + intervalMs,
    },
    ttlMs: Math.max(1_000, reserved.expiresAt - Date.now()),
  }));
  return { status: "pending" as const, intervalMs };
}

export async function getGrokConnectionStatus(userId: string) {
  const credentials = await credentialsStore.get(userId);
  if (!credentials) return { connected: false as const };
  const fresh = await getFreshGrokCredentials(userId, credentials);
  const models = await fetchGrokModels(fresh.accessToken);
  const identity = decodeGrokIdentity(fresh.idToken ?? fresh.accessToken);
  return {
    connected: true as const,
    ...identity,
    models,
    expiresAt: fresh.expiresAt,
  };
}

export async function disconnectGrok(userId: string) {
  await credentialsStore.delete(userId);
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
  credentialsGrantId: string;
  credentialsGrantContext: GrokAgentGrantContext;
}): Promise<GrokResponsesModel> {
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
  });
  return provider.responses(options.modelId);
}

async function getFreshGrokCredentials(userId: string, loaded?: GrokStoredCredentials): Promise<GrokStoredCredentials> {
  const current = loaded ?? await credentialsStore.get(userId);
  if (!current) throw new GrokConnectionError("Connect Grok before starting an AI stream.", 401);
  const expiresSoon = current.expiresAt <= Date.now() + TOKEN_REFRESH_SKEW_MS
    || grokAccessTokenIsExpiring(current.accessToken, TOKEN_REFRESH_SKEW_MS);
  if (!expiresSoon) return current;

  const existingRefresh = refreshPromises.get(userId);
  if (existingRefresh) return existingRefresh;
  const refresh = refreshGrokCredentialsWithLease(userId)
    .finally(() => {
      if (refreshPromises.get(userId) === refresh) refreshPromises.delete(userId);
    });
  refreshPromises.set(userId, refresh);
  return refresh;
}

async function refreshGrokCredentialsWithLease(userId: string): Promise<GrokStoredCredentials> {

  const leaseId = nanoid(16);
  const leased = await credentialsStore.update(userId, (latest) => {
    if (!latest) throw new GrokConnectionError("Connect Grok before starting an AI stream.", 401);
    const alreadyFresh = latest.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS
      && !grokAccessTokenIsExpiring(latest.accessToken, TOKEN_REFRESH_SKEW_MS);
    if (alreadyFresh) return { value: latest };
    if (latest.refreshLease && latest.refreshLease.expiresAt > Date.now()) return { value: latest };
    return { value: { ...latest, refreshLease: { id: leaseId, expiresAt: Date.now() + REFRESH_LEASE_MS } } };
  });
  if (!leased.refreshLease) return leased;
  if (leased.refreshLease.id !== leaseId) {
    return waitForGrokCredentialRefresh(userId, leased.refreshLease.expiresAt);
  }

  try {
    const refreshed = await refreshGrokTokens(leased.refreshToken);
    const completeRefresh = {
      ...refreshed,
      idToken: refreshed.idToken ?? leased.idToken,
      scope: refreshed.scope ?? leased.scope,
      tokenType: refreshed.tokenType ?? leased.tokenType,
    };
    return await credentialsStore.update(userId, (latest) => ({
      value: latest?.refreshLease?.id === leaseId
        ? completeRefresh
        : latest ?? completeRefresh,
    }));
  } catch (error) {
    await credentialsStore.update(userId, (latest) => ({
      value: latest?.refreshLease?.id === leaseId
        ? { ...latest, refreshLease: undefined }
        : latest ?? leased,
    })).catch(() => undefined);
    throw error;
  }
}

async function waitForGrokCredentialRefresh(userId: string, leaseExpiresAt: number) {
  while (Date.now() < leaseExpiresAt) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    const current = await credentialsStore.get(userId);
    if (!current) throw new GrokConnectionError("Connect Grok before starting an AI stream.", 401);
    if (!current.refreshLease) {
      const fresh = current.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS
        && !grokAccessTokenIsExpiring(current.accessToken, TOKEN_REFRESH_SKEW_MS);
      return fresh ? current : refreshGrokCredentialsWithLease(userId);
    }
  }
  return refreshGrokCredentialsWithLease(userId);
}
