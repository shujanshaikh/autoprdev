import { api } from "@autopr/backend/convex/_generated/api";
import { z } from "zod";

import { convexMutation, convexQuery } from "@/lib/convex-server";

const persistenceRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("patchAssistant"),
    assistantMessageId: z.string(),
    parts: z.array(z.unknown()),
  }),
  z.object({
    action: z.literal("markRunFinished"),
    runId: z.string(),
  }),
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {

  const { projectId, threadId } = await params;
  const parsed = persistenceRequestSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: "Invalid persistence request." }, { status: 400 });
  }

  const [project, thread] = await Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
  ]);

  if (!project || !thread || thread.projectId !== projectId) {
    return Response.json({ error: "Project or thread not found." }, { status: 404 });
  }

  if (parsed.data.action === "patchAssistant") {
    await convexMutation(api.messages.patchAssistant, {
      threadId,
      assistantMessageId: parsed.data.assistantMessageId,
      parts: parsed.data.parts,
    });
  } else {
    await convexMutation(api.threads.markRunFinished, {
      threadId,
      runId: parsed.data.runId,
    });
  }

  return Response.json({ ok: true });
}
