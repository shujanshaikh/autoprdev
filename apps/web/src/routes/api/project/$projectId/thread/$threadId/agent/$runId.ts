import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { runs } from "@trigger.dev/sdk";
import { z } from "zod";

import { convexAction, convexQuery } from "#/lib/convex-server";
import { sanitizeStoppedAssistantParts } from "#/lib/chat-messages";
import {
  isTriggerNotFoundError,
  lookupTriggerAgentRun,
  reconcileThreadWithTriggerRun,
} from "#/lib/trigger-agent-run-server";
import { agentProjectTag, agentThreadTag } from "#/lib/trigger-agent-contract";

const cancelRunRequestSchema = z.object({
  assistantMessage: z
    .object({
      id: z.string(),
      parts: z.array(z.any()),
      metadata: z.any().optional(),
    })
    .optional(),
});

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

  const requiredTags = [agentProjectTag(projectId), agentThreadTag(threadId)];
  const lookup = await lookupTriggerAgentRun(runId, requiredTags);

  if (lookup.status === "mismatch") {
    await reconcileThreadWithTriggerRun(threadId, runId, null);
    return Response.json({ error: "Agent run not found." }, { status: 404 });
  }

  if (lookup.status === "not-found") {
    await reconcileThreadWithTriggerRun(threadId, runId, null);
    return Response.json({ ok: true, alreadyCompleted: true });
  }

  if (lookup.run.isCompleted) {
    await reconcileThreadWithTriggerRun(threadId, runId, lookup.run);
    return Response.json({ ok: true, alreadyCompleted: true });
  }

  try {
    await runs.cancel(runId);
  } catch (error) {
    if (!isTriggerNotFoundError(error)) {
      throw error;
    }
  }

  const latestLookup = await lookupTriggerAgentRun(runId, requiredTags);
  const latestRun = latestLookup.status === "found" ? latestLookup.run : null;
  const { assistantMessage } = parsed.data;

  try {
    if (latestRun?.isCancelled && assistantMessage && assistantMessage.parts.length > 0) {
      const parts = sanitizeStoppedAssistantParts(assistantMessage.parts);

      await convexAction(api.messages.patchAssistant, {
        threadId,
        assistantMessageId: assistantMessage.id,
        parts,
        metadata: assistantMessage.metadata,
      });
    }
  } finally {
    await reconcileThreadWithTriggerRun(threadId, runId, latestRun);
  }

  return Response.json({
    ok: true,
    alreadyCompleted: Boolean(latestRun?.isCompleted && !latestRun.isCancelled),
  });
}

export const Route = createFileRoute("/api/project/$projectId/thread/$threadId/agent/$runId")({
  server: {
    handlers: { POST: async ({ request, params }: { request: Request; params: any }) => POST(request, { params: Promise.resolve(params) } as any) },
  },
});
