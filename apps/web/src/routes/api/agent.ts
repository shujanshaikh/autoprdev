import { createFileRoute } from "@tanstack/react-router";
import { createGrantLifecycle } from "@autopr/agent/grant-lifecycle";
import type { UIMessage } from "ai";
import { convertToModelMessages } from "ai";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { getAuthkit } from "@workos/authkit-tanstack-react-start";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  codexErrorResponse,
  createCodexAgentModelOptions,
  revokeCodexAgentModelOptions,
} from "#/lib/codex-auth-server";
import {
  AGENT_IDEMPOTENCY_KEY_TTL,
  AGENT_TASK_ID,
  agentUserTag,
} from "#/lib/trigger-agent-contract";
import type { agentTask } from "#/trigger/agent";

const standaloneAgentRequestSchema = z.object({
  messages: z
    .array(z.object({
      id: z.string(),
      role: z.enum(["system", "user", "assistant"]),
      parts: z.array(z.any()),
      metadata: z.any().optional(),
    }))
    .min(1),
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
});

async function POST(req: Request) {
  const parsed = standaloneAgentRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Send at least one UI message." }, { status: 400 });
  }

  const { model, reasoningEffort } = parsed.data;
  const messages = parsed.data.messages as UIMessage[];
  const authkit = await getAuthkit();
  const workOSSession = await authkit.getSession(req);
  if (!workOSSession) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const requestId = messages.at(-1)?.id ?? nanoid();

  const codex = await createCodexAgentModelOptions(req, model, reasoningEffort, {
    taskId: AGENT_TASK_ID,
    contextId: `standalone:${requestId}`,
  }).catch((error) =>
    error instanceof Error ? error : new Error("Could not load Codex credentials."),
  );

  if (codex instanceof Error) {
    return codexErrorResponse(codex, "Could not load Codex credentials.");
  }

  const grantLifecycle = createGrantLifecycle(codex, revokeCodexAgentModelOptions);
  try {
    const [modelMessages, idempotencyKey] = await Promise.all([
      convertToModelMessages(messages),
      idempotencyKeys.create(
        ["standalone-agent", workOSSession.user.id, requestId],
        { scope: "global" },
      ),
    ]);
    const run = await tasks.trigger<typeof agentTask>(
      AGENT_TASK_ID,
      {
        messages: modelMessages,
        options: {
          sandboxCacheKey: `trigger-agent:${workOSSession.user.id}:${requestId}`,
          codex,
        },
      },
      {
        idempotencyKey,
        idempotencyKeyTTL: AGENT_IDEMPOTENCY_KEY_TTL,
        tags: [agentUserTag(workOSSession.user.id)],
        metadata: {
          userId: workOSSession.user.id,
          userMessageId: requestId,
        },
      },
    );

    grantLifecycle.transfer();

    return new Response(null, {
      status: 202,
      headers: {
        "x-trigger-run-id": run.id,
      },
    });
  } catch (error) {
    await grantLifecycle.release().catch(() => undefined);
    throw error;
  }
}

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: { POST: async ({ request }: { request: Request }) => POST(request) },
  },
});
