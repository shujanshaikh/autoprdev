import { createFileRoute } from "@tanstack/react-router";
import type { UIMessage } from "ai";
import { convertToModelMessages } from "ai";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { nanoid } from "nanoid";

import { getCodexAgentModelConfig } from "#/lib/codex-auth-server";
import { AGENT_TASK_ID } from "#/lib/trigger-agent-contract";
import type { agentTask } from "#/trigger/agent";

async function POST(req: Request) {
  const { messages, model, reasoningEffort }: { messages: UIMessage[]; model?: string; reasoningEffort?: string } = await req.json();
  const [modelMessages, codex] = await Promise.all([
    convertToModelMessages(messages),
    getCodexAgentModelConfig(req, model, reasoningEffort).catch((error) =>
      error instanceof Error ? error : new Error("Could not load Codex credentials."),
    ),
  ]);

  if (codex instanceof Error) {
    return Response.json({ error: codex.message }, { status: 401 });
  }

  const requestId = messages.at(-1)?.id ?? nanoid();
  const idempotencyKey = await idempotencyKeys.create(
    ["standalone-agent", requestId],
    { scope: "global" },
  );
  const run = await tasks.trigger<typeof agentTask>(
    AGENT_TASK_ID,
    {
      messages: modelMessages,
      options: {
        sandboxCacheKey: `trigger-agent:${requestId}`,
        codex,
      },
    },
    {
      idempotencyKey,
      idempotencyKeyTTL: "10m",
    },
  );

  return new Response(null, {
    status: 202,
    headers: {
      "x-trigger-run-id": run.id,
    },
  });
}

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: { POST: async ({ request }: { request: Request }) => POST(request) },
  },
});
