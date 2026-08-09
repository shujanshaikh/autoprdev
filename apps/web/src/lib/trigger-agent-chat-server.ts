import "@tanstack/react-start/server-only";

import { api } from "@autopr/backend/convex/_generated/api";
import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { z } from "zod";

import { createAgentPersistenceGrant } from "#/lib/agent-persistence";
import { convexAction, convexMutation, convexQuery } from "#/lib/convex-server";
import {
  agentAuthErrorResponse,
  createAgentModelOptions,
  revokeAgentModelOptions,
} from "#/lib/agent-auth-server";
import { isAgentProvider } from "#/lib/agent-models";
import { persistedThreadWorkspace } from "#/lib/thread-workspace-server";
import { appendToTriggerSession } from "#/lib/trigger-session-append";
import {
  AGENT_CHAT_TASK_ID,
  AGENT_CHAT_OPERATION_HEADER,
  agentProjectTag,
  agentThreadTag,
  agentUserTag,
  threadSandboxCacheKey,
  type AgentChatClientData,
  type AgentChatClientInput,
} from "#/lib/trigger-agent-contract";
import type { agentChatTask } from "#/trigger/agent-chat";

const APPEND_OPERATION = "append";

const browserClientDataSchema = z.object({
  provider: z.enum(["openai-codex", "xai"]).optional(),
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
});

const sessionOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("start-session"),
    clientData: browserClientDataSchema.optional(),
  }),
  z.object({
    operation: z.literal("access-token"),
  }),
]);

const messageInputChunkSchema = z.object({
  kind: z.literal("message"),
  payload: z.object({
    chatId: z.string(),
    trigger: z.enum(["submit-message", "regenerate-message"]),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
}).passthrough();

const stopInputChunkSchema = z.object({
  kind: z.literal("stop"),
}).passthrough();

const chatInputChunkSchema = z.union([
  messageInputChunkSchema,
  stopInputChunkSchema,
]);

type AgentProject = {
  projectId: string;
  sandboxStatus: "creating" | "ready" | "failed";
  sandboxCacheKey: string;
  sandboxId?: string;
  sandboxWorkDir?: string;
  cloneUrl: string;
  currentBranch?: string;
  defaultBranch?: string;
  repoBranch?: string;
  repoName: string;
};

type AgentThread = {
  threadId: string;
  projectId: string;
  authorId: string;
  demoEnabled?: boolean;
  baseBranch?: string;
  featureBranch?: string;
  worktreePath?: string;
  workspaceMode?: "checkout" | "worktree";
  worktreeStatus?: "pending" | "provisioning" | "ready" | "failed" | "cleaned";
  headSha?: string;
  upstreamBranch?: string;
};

type AgentUserSettings = {
  demoRecordingExperimentEnabled?: boolean;
} | null;

const startAgentChatSession = chat.createStartSessionAction<typeof agentChatTask>(
  AGENT_CHAT_TASK_ID,
  {
    triggerConfig: {
      machine: "small-1x",
      maxAttempts: 1,
      idleTimeoutInSeconds: 30,
    },
  },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestedClientData(metadata: Record<string, unknown> | undefined): AgentChatClientInput {
  return {
    provider: isAgentProvider(metadata?.provider) ? metadata.provider : undefined,
    model: typeof metadata?.model === "string" ? metadata.model : undefined,
    reasoningEffort:
      typeof metadata?.reasoningEffort === "string"
        ? metadata.reasoningEffort
        : undefined,
  };
}

function triggerApiBaseUrl() {
  const raw = process.env.TRIGGER_API_URL?.trim() || "https://api.trigger.dev";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TRIGGER_API_URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("TRIGGER_API_URL must use HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

async function loadAgentContext(projectId: string, threadId: string) {
  const [project, thread, userSettings] = await Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
    convexQuery(api.userSettings.get, {}),
  ]);

  if (!project || !thread || thread.projectId !== projectId) {
    return { response: Response.json({ error: "Project or thread not found." }, { status: 404 }) } as const;
  }

  return {
    project: project as AgentProject,
    thread: thread as AgentThread,
    userSettings: userSettings as AgentUserSettings,
  } as const;
}

async function createTrustedClientData(options: {
  request: Request;
  project: AgentProject;
  thread: AgentThread;
  userSettings: AgentUserSettings;
  requested: AgentChatClientInput;
}) {
  const persistedWorkspace = persistedThreadWorkspace(options.project, options.thread);
  const [worktree, model, persistenceGrant] = await Promise.all([
    persistedWorkspace
      ? Promise.resolve(persistedWorkspace)
      : convexAction(api.projectActions.resolveThreadWorkspace, {
          projectId: options.project.projectId,
          threadId: options.thread.threadId,
        }),
    createAgentModelOptions(
      options.request,
      options.requested.provider,
      options.requested.model,
      options.requested.reasoningEffort,
      {
        taskId: AGENT_CHAT_TASK_ID,
        contextId: `${options.project.projectId}:${options.thread.threadId}`,
      },
    ),
    createAgentPersistenceGrant(),
  ]);

  await convexMutation(api.threads.addAgentSessionPersistenceGrant, {
    threadId: options.thread.threadId,
    tokenHash: persistenceGrant.tokenHash,
  });

  const clientData: AgentChatClientData = {
    projectId: options.project.projectId,
    threadId: options.thread.threadId,
    sandboxCacheKey: threadSandboxCacheKey(
      options.project.sandboxCacheKey,
      options.thread.threadId,
    ),
    sandboxId: options.project.sandboxId,
    sandboxWorkDir: worktree.worktreePath,
    repoUrl: options.project.cloneUrl,
    repoBranch: worktree.featureBranch,
    repoName: options.project.repoName,
    persistenceToken: persistenceGrant.token,
    demoEnabled: Boolean(
      options.thread.demoEnabled &&
        options.userSettings?.demoRecordingExperimentEnabled,
    ),
    model,
  };

  return clientData;
}

async function mintSessionToken(chatId: string) {
  return await auth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  });
}

function forwardedInputHeaders(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const headers = new Headers({
    Authorization: authorization,
    "Content-Type": "application/json",
    "x-trigger-source": request.headers.get("x-trigger-source") ?? "sdk",
  });
  const partId = request.headers.get("x-part-id");
  if (partId) {
    headers.set("X-Part-Id", partId);
  }

  return headers;
}

async function proxyInputChunk(options: {
  request: Request;
  body: unknown;
  project: AgentProject;
  thread: AgentThread;
  userSettings: AgentUserSettings;
}) {
  const parsed = chatInputChunkSchema.safeParse(options.body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid Trigger.dev chat input." }, { status: 400 });
  }

  const headers = forwardedInputHeaders(options.request);
  if (!headers) {
    return Response.json({ error: "Missing Trigger.dev session token." }, { status: 401 });
  }

  let inputChunk = parsed.data;
  let issuedModel: AgentChatClientData["model"] | undefined;
  if (inputChunk.kind === "message") {
    if (inputChunk.payload.chatId !== options.thread.threadId) {
      return Response.json({ error: "Chat session does not match this thread." }, { status: 409 });
    }
    if (options.project.sandboxStatus !== "ready" || !options.project.sandboxId) {
      return Response.json({ error: "Project sandbox is not ready yet." }, { status: 409 });
    }

    let trustedClientData: AgentChatClientData;
    try {
      trustedClientData = await createTrustedClientData({
        request: options.request,
        project: options.project,
        thread: options.thread,
        userSettings: options.userSettings,
        requested: requestedClientData(inputChunk.payload.metadata),
      });
    } catch (error) {
      return agentAuthErrorResponse(error, "Could not load model credentials.");
    }
    issuedModel = trustedClientData.model;

    inputChunk = {
      ...inputChunk,
      payload: {
        ...inputChunk.payload,
        // Identity, project context, persistence grants, and model credential
        // grants are server-owned. Never merge browser claims into this object.
        metadata: trustedClientData,
      },
    };
  }

  const triggerBaseUrl = triggerApiBaseUrl();
  const appendUrl = new URL(
    `${triggerBaseUrl.pathname}/realtime/v1/sessions/${encodeURIComponent(options.thread.threadId)}/in/append`,
    triggerBaseUrl,
  );
  try {
    const response = await appendToTriggerSession({
      url: appendUrl.toString(),
      trustedOrigin: triggerBaseUrl.origin,
      headers,
      body: JSON.stringify(inputChunk),
      signal: options.request.signal,
    });
    if (!response.ok && issuedModel) {
      await revokeAgentModelOptions(issuedModel).catch(() => undefined);
    }
    return response;
  } catch (error) {
    if (issuedModel) {
      await revokeAgentModelOptions(issuedModel).catch(() => undefined);
    }
    throw error;
  }
}

export function isAgentChatRequest(request: Request, body: unknown) {
  return (
    request.headers.get(AGENT_CHAT_OPERATION_HEADER) === APPEND_OPERATION ||
    (isRecord(body) &&
      (body.operation === "start-session" || body.operation === "access-token"))
  );
}

export async function handleAgentChatRequest(options: {
  request: Request;
  body: unknown;
  projectId: string;
  threadId: string;
}) {
  const context = await loadAgentContext(options.projectId, options.threadId);
  if ("response" in context) {
    return context.response;
  }

  if (options.request.headers.get(AGENT_CHAT_OPERATION_HEADER) === APPEND_OPERATION) {
    return await proxyInputChunk({
      request: options.request,
      body: options.body,
      project: context.project,
      thread: context.thread,
      userSettings: context.userSettings,
    });
  }

  const operation = sessionOperationSchema.safeParse(options.body);
  if (!operation.success) {
    return Response.json({ error: "Invalid agent chat operation." }, { status: 400 });
  }

  if (operation.data.operation === "access-token") {
    try {
      return Response.json({
        publicAccessToken: await mintSessionToken(options.threadId),
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Could not mint chat token." },
        { status: 500 },
      );
    }
  }

  if (context.project.sandboxStatus !== "ready" || !context.project.sandboxId) {
    return Response.json({ error: "Project sandbox is not ready yet." }, { status: 409 });
  }

  let clientData: AgentChatClientData;
  try {
    clientData = await createTrustedClientData({
      request: options.request,
      project: context.project,
      thread: context.thread,
      userSettings: context.userSettings,
      requested: operation.data.clientData ?? {},
    });
  } catch (error) {
    return agentAuthErrorResponse(error, "Could not load model credentials.");
  }

  try {
    const session = await startAgentChatSession({
      chatId: options.threadId,
      clientData,
      triggerConfig: {
        tags: [
          agentProjectTag(options.projectId),
          agentThreadTag(options.threadId),
          agentUserTag(context.thread.authorId),
        ],
      },
      metadata: {
        projectId: options.projectId,
        threadId: options.threadId,
        authorId: context.thread.authorId,
      },
    });

    await convexMutation(api.threads.markAgentSessionCreated, {
      threadId: options.threadId,
    });

    return Response.json({
      publicAccessToken: session.publicAccessToken,
    });
  } catch (error) {
    await revokeAgentModelOptions(clientData.model).catch(() => undefined);
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not start agent chat." },
      { status: 500 },
    );
  }
}
