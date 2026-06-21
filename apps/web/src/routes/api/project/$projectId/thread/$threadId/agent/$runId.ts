import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { getRun } from "workflow/api";
import { z } from "zod";

import { convexAction, convexMutation, convexQuery } from "#/lib/convex-server";
import { sanitizeStoppedAssistantParts } from "#/lib/chat-messages";

const cancelRunRequestSchema = z.object({
  assistantMessage: z
    .object({
      id: z.string(),
      parts: z.array(z.any()),
      metadata: z.any().optional(),
    })
    .optional(),
});

function isWorkflowRunNotFoundError(error: unknown) {
  return error instanceof Error && error.name === "WorkflowRunNotFoundError";
}

async function POST(
  req: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; threadId: string; runId: string }>;
  },
) {
  const parsed = cancelRunRequestSchema.safeParse(await req.json().catch(() => ({})));

  if (!parsed.success) {
    return Response.json({ error: "Invalid cancel request." }, { status: 400 });
  }

  const { projectId: projectIdParam, threadId: threadIdParam, runId } = await params;
  const projectId = projectIdParam;
  const threadId = threadIdParam;

  const [project, thread] = await Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
  ]);

  if (!project || !thread || thread.projectId !== projectId) {
    return Response.json({ error: "Project or thread not found." }, { status: 404 });
  }

  const { assistantMessage } = parsed.data;

  if (assistantMessage && assistantMessage.parts.length > 0) {
    const parts = sanitizeStoppedAssistantParts(assistantMessage.parts);

    await convexAction(api.messages.patchAssistant, {
      threadId,
      assistantMessageId: assistantMessage.id,
      parts,
      metadata: assistantMessage.metadata,
    });
  }

  try {
    await getRun(runId).cancel();
  } catch (error) {
    if (!isWorkflowRunNotFoundError(error)) {
      throw error;
    }
  }

  await convexMutation(api.threads.markRunFinished, {
    threadId,
    runId,
  });

  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/project/$projectId/thread/$threadId/agent/$runId")({
  server: {
    handlers: { POST: async ({ request, params }: { request: Request; params: any }) => POST(request, { params: Promise.resolve(params) } as any) },
  },
});
