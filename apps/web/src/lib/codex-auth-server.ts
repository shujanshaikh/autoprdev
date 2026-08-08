import "@tanstack/react-start/server-only";

import {
  chatGPTAuth,
  CodexConnectionError,
  createCodexAgentGrant,
  createCodexResponsesModel,
  type CodexResponsesModel,
  getWorkOSVault,
  isMissingVaultObject,
  isVaultConflict,
  revokeCodexAgentGrant,
  vaultObjectName,
} from "#/lib/codex-auth-runtime-server";
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  isCodexReasoningEffortForModel,
  normalizeCodexModelId,
  normalizeCodexModelList,
  selectCodexModel,
} from "#/lib/codex-models";
import {
  createStoredCodexSessionLink,
  getCodexSessionCookieHeaders,
  parseStoredCodexSessionLink,
  requestWithChatGPTSession,
  resolveCodexSession,
} from "#/lib/codex-session";
import { requireWorkOSAuth } from "#/lib/github-oauth-server";
import type { CodexAgentModelOptions } from "#/lib/trigger-agent-contract";

export const CHATGPT_AUTH_BASE_PATH = "/api/chatgpt";

export { CodexConnectionError, createCodexResponsesModel };

async function loadAccountCodexSessionLink() {
  const authState = await requireWorkOSAuth();
  const object = await getWorkOSVault()
    .readObjectByName(vaultObjectName("account-session", authState.user.id))
    .catch((error: unknown) => {
      if (isMissingVaultObject(error)) return undefined;
      throw error;
    });
  if (!object?.value) {
    return undefined;
  }

  const link = parseStoredCodexSessionLink(object.value);
  return link ? { link, vaultObjectId: object.id } : undefined;
}

async function persistAccountCodexSession(options: {
  userId: string;
  sessionCookieHeader: string;
}) {
  const value = JSON.stringify(createStoredCodexSessionLink(options.sessionCookieHeader));
  const objectName = vaultObjectName("account-session", options.userId);
  const existingObject = await getWorkOSVault().readObjectByName(objectName).catch((error: unknown) => {
    if (isMissingVaultObject(error)) return undefined;
    throw error;
  });
  const existingLink = existingObject?.value
    ? parseStoredCodexSessionLink(existingObject.value)
    : undefined;

  if (existingLink?.sessionCookieHeader === options.sessionCookieHeader) {
    return;
  }

  if (existingObject) {
    await getWorkOSVault().updateObject({ id: existingObject.id, value });
  } else {
    await getWorkOSVault()
      .createObject({
        name: objectName,
        value,
        context: {
          app: "autopr",
          purpose: "login-with-chatgpt-account-session",
          userId: options.userId,
        },
      })
      .catch(async (error: unknown) => {
        if (!isVaultConflict(error)) {
          throw error;
        }

        const latest = await getWorkOSVault().readObjectByName(objectName);
        return await getWorkOSVault().updateObject({ id: latest.id, value });
      });
  }
}

async function resolveAccountCodexSession(request: Request) {
  const authState = await requireWorkOSAuth();
  const resolved = await resolveCodexSession({
    request,
    getSession: (sessionRequest) => chatGPTAuth.getSession(sessionRequest),
    loadAccountCookieHeader: async () =>
      (await loadAccountCodexSessionLink())?.link.sessionCookieHeader,
  });

  if (resolved?.source === "request" && resolved.session.status === "authenticated") {
    await persistAccountCodexSession({
      userId: authState.user.id,
      sessionCookieHeader: resolved.cookieHeader,
    });
  }

  return { authState, resolved };
}

async function removeAccountCodexSessionLink() {
  const accountLink = await loadAccountCodexSessionLink();
  if (accountLink) {
    await getWorkOSVault()
      .deleteObject({ id: accountLink.vaultObjectId })
      .catch((error: unknown) => {
        if (!isMissingVaultObject(error)) {
          throw error;
        }
      });
  }
}

export async function handleChatGPTAuthRequest(request: Request) {
  const route = new URL(request.url).pathname.slice(CHATGPT_AUTH_BASE_PATH.length);
  if (route === "/logout") {
    return disconnectCodex(request);
  }

  if (route === "/login") {
    await requireWorkOSAuth();
    return chatGPTAuth.handler(request);
  }

  const { resolved } = await resolveAccountCodexSession(request);
  const response = await chatGPTAuth.handler(resolved?.request ?? request);

  if (route === "/status" && resolved?.session.status === "pending") {
    await resolveAccountCodexSession(request);
  }

  return response;
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
  const { resolved } = await resolveAccountCodexSession(request);

  if (!resolved || resolved.session.status !== "authenticated") {
    return { connected: false as const };
  }

  const session = resolved.session;
  const models = await chatGPTAuth.getModels(resolved.request)
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
  await requireWorkOSAuth();
  const accountLink = await loadAccountCodexSessionLink();
  const cookieHeaders = getCodexSessionCookieHeaders(
    request,
    accountLink?.link.sessionCookieHeader,
  );

  let response: Response | undefined;
  for (const cookieHeader of cookieHeaders) {
    const sessionRequest = requestWithChatGPTSession(request, cookieHeader);
    response = await chatGPTAuth.handler(
      rewriteToChatGPTPath(sessionRequest, "/logout", "POST"),
    );
  }

  response ??= await chatGPTAuth.handler(rewriteToChatGPTPath(request, "/logout", "POST"));
  await removeAccountCodexSessionLink();
  return response;
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
  const { authState, resolved } = await resolveAccountCodexSession(request);

  if (!resolved || resolved.session.status !== "authenticated") {
    throw new CodexConnectionError("Connect Codex before starting an AI stream.", 401);
  }

  const availableModels = await getAvailableModels(resolved.request);
  const modelId = selectAvailableModel(model, availableModels);
  const selectedReasoningEffort = normalizeCodexReasoningEffort(modelId, reasoningEffort);

  return {
    provider: "openai-codex" as const,
    modelId,
    reasoningEffort: selectedReasoningEffort,
    chatgptCookieHeader: resolved.cookieHeader,
    userId: authState.user.id,
  };
}

/**
 * Builds the serializable Codex options for a Trigger.dev agent run. The
 * session cookie is stored in a short-lived WorkOS Vault grant so only the
 * opaque grant id is placed on the retained run payload; the worker redeems
 * it inside the run.
 */
export async function createCodexAgentModelOptions<
  TTaskId extends "autopr-agent" | "autopr-chat-agent",
>(
  request: Request,
  model?: string,
  reasoningEffort?: string,
  grantContext?: {
    taskId: TTaskId;
    contextId: string;
  },
): Promise<CodexAgentModelOptions<TTaskId>> {
  if (!grantContext) {
    throw new CodexConnectionError("Codex agent grant context is required.", 500);
  }
  const config = await getCodexAgentModelConfig(request, model, reasoningEffort);
  const credentialsGrantContext = {
    userId: config.userId,
    ...grantContext,
  };
  const credentialsGrantId = await createCodexAgentGrant({
    ...credentialsGrantContext,
    sessionCookieHeader: config.chatgptCookieHeader,
  });

  return {
    provider: config.provider,
    modelId: config.modelId,
    reasoningEffort: config.reasoningEffort,
    credentialsGrantId,
    credentialsGrantContext,
  };
}

export function revokeCodexAgentModelOptions(options: CodexAgentModelOptions) {
  return revokeCodexAgentGrant(options.credentialsGrantId);
}

export function codexErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CodexConnectionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
