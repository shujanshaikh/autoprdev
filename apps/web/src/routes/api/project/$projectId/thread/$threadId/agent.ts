import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { convertToModelMessages, type UIMessage } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getAuthkit } from "@workos/authkit-tanstack-react-start";

import { convexAction, convexMutation, convexQuery } from "#/lib/convex-server";
import { sanitizeMessageForModelConversion, toUIMessage, type StoredMessageRow } from "#/lib/chat-messages";
import { codexErrorResponse, getCodexAgentModelConfig } from "#/lib/codex-auth-server";
import {
  AGENT_IDEMPOTENCY_KEY_TTL,
  AGENT_TASK_ID,
  agentProjectTag,
  agentThreadTag,
} from "#/lib/trigger-agent-contract";
import {
  lookupTriggerAgentRun,
  reconcileThreadWithTriggerRun,
} from "#/lib/trigger-agent-run-server";
import type { agentTask } from "#/trigger/agent";

const agentRequestSchema = z.object({
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
  message: z.object({
    id: z.string(),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(z.any()),
    metadata: z.any().optional(),
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getR2Key(part: UIMessage["parts"][number]) {
  if (part.type !== "file" || !isRecord(part.providerMetadata)) {
    return null;
  }

  const autoprMetadata = part.providerMetadata.autopr;

  return isRecord(autoprMetadata) && typeof autoprMetadata.r2Key === "string"
    ? autoprMetadata.r2Key
    : null;
}

function stripAutoprProviderMetadata(part: UIMessage["parts"][number]) {
  if (part.type !== "file" || !isRecord(part.providerMetadata)) {
    return part;
  }

  const providerMetadata = { ...part.providerMetadata };
  delete providerMetadata.autopr;

  return {
    ...part,
    providerMetadata: Object.keys(providerMetadata).length > 0 ? providerMetadata : undefined,
  };
}

function acceptedAgentRunResponse(runId: string) {
  return new Response(null, {
    status: 202,
    headers: {
      "x-trigger-run-id": runId,
    },
  });
}

async function refreshR2FileUrlsForModel(message: UIMessage): Promise<UIMessage> {
  const parts = await Promise.all(message.parts.map(async (part) => {
    const key = getR2Key(part);

    if (!key || part.type !== "file") {
      return stripAutoprProviderMetadata(part);
    }

    return stripAutoprProviderMetadata({
      ...part,
      url: await convexQuery(api.imageUploads.getUrl, { key }),
    });
  }));

  return {
    ...message,
    parts,
  };
}

async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {

  const parsed = agentRequestSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: "Send the latest UI message." }, { status: 400 });
  }

  const { projectId: projectIdParam, threadId: threadIdParam } = await params;
  const projectId = projectIdParam;
  const threadId = threadIdParam;

  return Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
    convexQuery(api.userSettings.get, {}),
  ]).then(async ([project, thread, userSettings]) => {
    if (!project || !thread || thread.projectId !== projectId) {
      return Response.json({ error: "Project or thread not found." }, { status: 404 });
    }

    if (project.sandboxStatus !== "ready" || !project.sandboxId) {
      return Response.json({ error: "Project sandbox is not ready yet." }, { status: 409 });
    }

    const requiredRunTags = [agentProjectTag(projectId), agentThreadTag(threadId)];
    if (thread.currentRunId) {
      const currentRunLookup = await lookupTriggerAgentRun(thread.currentRunId, requiredRunTags);

      if (currentRunLookup.status === "found" && !currentRunLookup.run.isCompleted) {
        if (currentRunLookup.run.metadata?.userMessageId === parsed.data.message.id) {
          return acceptedAgentRunResponse(thread.currentRunId);
        }

        return Response.json(
          { error: "An agent run is already active for this thread." },
          { status: 409 },
        );
      }

      await reconcileThreadWithTriggerRun(
        threadId,
        thread.currentRunId,
        currentRunLookup.status === "found" ? currentRunLookup.run : null,
      );
    }

    const authkit = await getAuthkit();
    const workOSSession = await authkit.getSession(req);

    if (!workOSSession) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const codex = await getCodexAgentModelConfig(req, parsed.data.model, parsed.data.reasoningEffort).catch((error) =>
      error instanceof Error ? error : new Error("Could not load Codex credentials."),
    );

    if (codex instanceof Error) {
      return codexErrorResponse(codex, "Could not load Codex credentials.");
    }

    const userMessage = parsed.data.message as UIMessage;
    const requestedAssistantMessageId = nanoid();
    const [assistantMessageId, dbMessages] = await Promise.all([
      convexMutation(api.messages.createTurn, {
        projectId,
        threadId,
        userMessage: {
          messageId: userMessage.id,
          parts: userMessage.parts,
          metadata: userMessage.metadata,
        },
        assistantMessageId: requestedAssistantMessageId,
      }),
      convexAction(api.messages.listByThreadHydrated, { threadId }),
    ]);
    const uiMessages: UIMessage[] = dbMessages.flatMap((message: StoredMessageRow) => {
      const uiMessage = toUIMessage(message);
      return uiMessage.role !== "assistant" || uiMessage.parts.length > 0 || uiMessage.id === assistantMessageId
        ? [uiMessage]
        : [];
    });
    const modelInputMessages = [
      ...uiMessages,
      ...(uiMessages.some((message) => message.id === userMessage.id) ? [] : [userMessage]),
      ...(uiMessages.some((message) => message.id === assistantMessageId)
        ? []
        : [{ id: assistantMessageId, role: "assistant" as const, parts: [] }]),
    ];
    const messagesForModel = await Promise.all(modelInputMessages.map(refreshR2FileUrlsForModel));
    const sanitizedMessagesForModel = [];
    for (const message of messagesForModel) {
      const sanitizedMessage = sanitizeMessageForModelConversion(message);
      if (sanitizedMessage.id !== assistantMessageId || sanitizedMessage.parts.length > 0) {
        sanitizedMessagesForModel.push(sanitizedMessage);
      }
    }
    const modelMessages = await convertToModelMessages(sanitizedMessagesForModel);

    const idempotencyKey = await idempotencyKeys.create(
      ["agent", threadId, assistantMessageId],
      { scope: "global" },
    );
    const run = await tasks.trigger<typeof agentTask>(
      AGENT_TASK_ID,
      {
        messages: modelMessages,
        options: {
          projectId,
          threadId,
          sandboxCacheKey: project.sandboxCacheKey,
          sandboxId: project.sandboxId,
          sandboxWorkDir: project.sandboxWorkDir,
          repoUrl: project.cloneUrl,
          repoBranch: project.repoBranch,
          repoName: project.repoName,
          assistantMessageId,
          demoEnabled: Boolean(thread.demoEnabled && userSettings.demoRecordingExperimentEnabled),
          convexAuth: workOSSession,
          codex,
        },
      },
      {
        idempotencyKey,
        idempotencyKeyTTL: AGENT_IDEMPOTENCY_KEY_TTL,
        tags: requiredRunTags,
        metadata: {
          projectId,
          threadId,
          userMessageId: userMessage.id,
          assistantMessageId,
        },
      },
    );

    await convexMutation(api.threads.markRunStarted, {
      threadId,
      runId: run.id,
    });

    return acceptedAgentRunResponse(run.id);
  });
}

export const Route = createFileRoute("/api/project/$projectId/thread/$threadId/agent")({
  server: {
    handlers: { POST: async ({ request, params }: { request: Request; params: any }) => POST(request, { params: Promise.resolve(params) } as any) },
  },
});
