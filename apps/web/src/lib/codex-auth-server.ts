import "@tanstack/react-start/server-only";

import { api } from "@autopr/backend/convex/_generated/api";
import type { ChatGPTUser } from "@opencoredev/loginwithchatgpt-server";

import {
  chatGPTAuth,
  CODEX_SESSION_TTL_MS,
  CodexConnectionError,
  createCodexResponsesModel,
  type CodexResponsesModel,
  getWorkOSVault,
  isMissingVaultObject,
  isVaultConflict,
  vaultObjectName,
} from "#/lib/codex-auth-runtime-server";
import { convexMutation, convexQuery } from "#/lib/convex-server";
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

export const CHATGPT_AUTH_BASE_PATH = "/api/chatgpt";

export { CodexConnectionError, createCodexResponsesModel };

async function getCodexCredentialState() {
  const connection = await convexQuery(api.codexAuth.getConnection, {});
  if (!connection) {
    return { connection: undefined, reference: undefined };
  }

  return {
    connection,
    reference: {
      vaultObjectId: connection.vaultObjectId,
      vaultVersionId: connection.vaultVersionId,
    },
  };
}

async function readVaultObject(id: string) {
  return await getWorkOSVault().readObject({ id }).catch((error: unknown) => {
    if (isMissingVaultObject(error)) {
      return undefined;
    }
    throw error;
  });
}

async function loadAccountCodexSessionLink() {
  const { reference } = await getCodexCredentialState();
  if (!reference) {
    return undefined;
  }

  const object = await readVaultObject(reference.vaultObjectId);
  if (!object?.value) {
    return undefined;
  }

  const link = parseStoredCodexSessionLink(object.value);
  return link ? { link, reference } : undefined;
}

async function persistAccountCodexSession(options: {
  userId: string;
  sessionCookieHeader: string;
  user?: ChatGPTUser;
}) {
  const value = JSON.stringify(createStoredCodexSessionLink(options.sessionCookieHeader));
  const { connection, reference } = await getCodexCredentialState();
  const existingObject = reference ? await readVaultObject(reference.vaultObjectId) : undefined;
  const existingLink = existingObject?.value
    ? parseStoredCodexSessionLink(existingObject.value)
    : undefined;

  if (
    existingLink?.sessionCookieHeader === options.sessionCookieHeader &&
    connection &&
    connection.accountId === options.user?.accountId &&
    connection.email === options.user?.email
  ) {
    return;
  }

  const vaultObject = existingObject
    ? await getWorkOSVault().updateObject({ id: existingObject.id, value })
    : await getWorkOSVault()
        .createObject({
          name: vaultObjectName("account-session", options.userId),
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

          const latest = await getWorkOSVault().readObjectByName(
            vaultObjectName("account-session", options.userId),
          );
          return await getWorkOSVault().updateObject({ id: latest.id, value });
        });

  await convexMutation(api.codexAuth.upsert, {
    vaultObjectId: vaultObject.id,
    vaultVersionId: vaultObject.metadata?.versionId,
    accountId: options.user?.accountId,
    email: options.user?.email,
    expiresAt: Date.now() + CODEX_SESSION_TTL_MS,
  });
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
      user: resolved.session.user,
    });
  }

  return resolved;
}

async function removeAccountCodexSessionLink() {
  const { reference } = await getCodexCredentialState();
  if (reference) {
    await getWorkOSVault()
      .deleteObject({ id: reference.vaultObjectId })
      .catch((error: unknown) => {
        if (!isMissingVaultObject(error)) {
          throw error;
        }
      });
  }

  await convexMutation(api.codexAuth.remove, {});
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

  const resolved = await resolveAccountCodexSession(request);
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
  const resolved = await resolveAccountCodexSession(request);

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
  const resolved = await resolveAccountCodexSession(request);

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
  };
}

export function codexErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CodexConnectionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
