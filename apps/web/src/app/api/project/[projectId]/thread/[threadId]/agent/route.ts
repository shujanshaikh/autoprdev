import { api } from "@autopr/backend/convex/_generated/api";
import { convertToModelMessages, createUIMessageStreamResponse, type UIMessage } from "ai";
import { nanoid } from "nanoid";
import { start } from "workflow/api";
import { z } from "zod";

import { ConvexAuthConfigurationError, getAuthenticatedConvexClient } from "@/lib/convex-server";
import { toUIMessage } from "@/lib/chat-messages";
import { agentWorkflow } from "@/workflows/agent/workflow";

const agentRequestSchema = z.object({
  message: z.object({
    id: z.string(),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(z.any()),
    metadata: z.any().optional(),
  }),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {
  let convex: Awaited<ReturnType<typeof getAuthenticatedConvexClient>>;

  try {
    convex = await getAuthenticatedConvexClient();
  } catch (error) {
    if (error instanceof ConvexAuthConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }

    throw error;
  }

  if (!convex) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId: projectIdParam, threadId: threadIdParam } = await params;
  const projectId = projectIdParam;
  const threadId = threadIdParam;
  const parsed = agentRequestSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: "Send the latest UI message." }, { status: 400 });
  }

  const [project, thread] = await Promise.all([
    convex.client.query(api.projects.get, { projectId }),
    convex.client.query(api.threads.get, { threadId }),
  ]);

  if (!project || !thread || thread.projectId !== projectId) {
    return Response.json({ error: "Project or thread not found." }, { status: 404 });
  }

  if (project.sandboxStatus !== "ready" || !project.sandboxId) {
    return Response.json({ error: "Project sandbox is not ready yet." }, { status: 409 });
  }

  const userMessage = parsed.data.message as UIMessage;
  const assistantMessageId = nanoid();

  await convex.client.mutation(api.messages.createTurn, {
    projectId,
    threadId,
    userMessage: {
      messageId: userMessage.id,
      parts: userMessage.parts,
      metadata: userMessage.metadata,
    },
    assistantMessageId,
  });

  const dbMessages = await convex.client.query(api.messages.listByThread, { threadId });
  const uiMessages = dbMessages
    .map(toUIMessage)
    .filter((message) => message.role !== "assistant" || message.parts.length > 0 || message.id === assistantMessageId);
  const modelMessages = await convertToModelMessages(
    uiMessages.filter((message) => message.id !== assistantMessageId || message.parts.length > 0),
  );
  const run = await start(agentWorkflow, [
    modelMessages,
    {
      projectId,
      threadId,
      sandboxCacheKey: project.sandboxCacheKey,
      sandboxId: project.sandboxId,
      repoUrl: project.cloneUrl,
      repoBranch: project.repoBranch,
      assistantMessageId,
      convexUrl: convex.url,
      convexAuthToken: convex.token,
    },
  ]);

  await convex.client.mutation(api.threads.markRunStarted, {
    threadId,
    runId: run.runId,
  });

  return createUIMessageStreamResponse({
    stream: run.readable,
    headers: {
      "x-workflow-run-id": run.runId,
    },
  });
}
