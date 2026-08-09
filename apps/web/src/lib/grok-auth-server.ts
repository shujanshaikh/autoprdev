import "@tanstack/react-start/server-only";

import { GrokOAuthError } from "@autopr/grok/core";
import {
  createGrokAgentGrant,
  disconnectGrok,
  getGrokConnectionStatus,
  GrokConnectionError,
  pollGrokDeviceAuthorization,
  revokeGrokAgentGrant,
  startGrokDeviceAuthorization,
} from "#/lib/grok-auth-runtime-server";
import { requireWorkOSAuth } from "#/lib/github-oauth-server";
import type { GrokAgentModelOptions } from "#/lib/trigger-agent-contract";

export { GrokConnectionError };

export async function startAuthenticatedGrokDeviceAuthorization() {
  const authState = await requireWorkOSAuth();
  return startGrokDeviceAuthorization(authState.user.id);
}

export async function pollAuthenticatedGrokDeviceAuthorization(flowId: string) {
  const authState = await requireWorkOSAuth();
  return pollGrokDeviceAuthorization(authState.user.id, flowId);
}

export async function getAuthenticatedGrokConnectionStatus() {
  const authState = await requireWorkOSAuth();
  return getGrokConnectionStatus(authState.user.id);
}

export async function disconnectAuthenticatedGrok() {
  const authState = await requireWorkOSAuth();
  await disconnectGrok(authState.user.id);
}

export async function createGrokAgentModelOptions<TTaskId extends "autopr-agent" | "autopr-chat-agent">(
  modelId: string | undefined,
  grantContext: { taskId: TTaskId; contextId: string },
): Promise<GrokAgentModelOptions<TTaskId>> {
  const authState = await requireWorkOSAuth();
  const status = await getGrokConnectionStatus(authState.user.id);
  if (!status.connected) throw new GrokConnectionError("Connect Grok before starting an AI stream.", 401);
  const selectedModel = modelId?.trim() || status.models[0];
  if (!selectedModel || !status.models.includes(selectedModel)) {
    throw new GrokConnectionError("Selected Grok model is not available for this subscription.", 400);
  }
  const credentialsGrantContext = { userId: authState.user.id, ...grantContext };
  const credentialsGrantId = await createGrokAgentGrant(credentialsGrantContext);
  return {
    provider: "xai",
    modelId: selectedModel,
    credentialsGrantId,
    credentialsGrantContext,
  };
}

export function revokeGrokAgentModelOptions(options: GrokAgentModelOptions) {
  return revokeGrokAgentGrant(options.credentialsGrantId);
}

export function grokErrorResponse(error: unknown, fallback: string) {
  if (error instanceof GrokConnectionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof GrokOAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
