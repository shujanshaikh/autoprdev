import { createFileRoute } from "@tanstack/react-router";
import type { UIMessage } from "ai";
import { convertToModelMessages, createUIMessageStreamResponse } from "ai";
import { nanoid } from "nanoid";
import { start } from "workflow/api";

import { getCodexAgentModelConfig } from "#/lib/codex-auth-server";
import { agentWorkflow } from "#/workflows/agent/workflow";

async function POST(req: Request) {
  const { messages, model, reasoningEffort }: { messages: UIMessage[]; model?: string; reasoningEffort?: string } = await req.json();
  const [modelMessages, codex] = await Promise.all([
    convertToModelMessages(messages),
    getCodexAgentModelConfig(model, reasoningEffort).catch((error) =>
      error instanceof Error ? error : new Error("Could not load Codex credentials."),
    ),
  ]);

  if (codex instanceof Error) {
    return Response.json({ error: codex.message }, { status: 401 });
  }

  const run = await start(agentWorkflow, [
    modelMessages,
    {
      sandboxCacheKey: `workflow-agent:${nanoid()}`,
      codex,
    },
  ]);

  return createUIMessageStreamResponse({
    stream: run.readable,
    headers: {
      "x-workflow-run-id": run.runId,
    },
  });
}

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: { POST: async ({ request }: { request: Request }) => POST(request) },
  },
});
