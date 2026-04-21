import type { UIMessage } from "ai";
import { convertToModelMessages, createUIMessageStreamResponse } from "ai";
import { nanoid } from "nanoid";
import { start } from "workflow/api";

import { agentWorkflow } from "@/workflows/agent/workflow";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const modelMessages = await convertToModelMessages(messages);
  const run = await start(agentWorkflow, [
    modelMessages,
    {
      sandboxCacheKey: `workflow-agent:${nanoid()}`,
    },
  ]);

  return createUIMessageStreamResponse({
    stream: run.readable,
    headers: {
      "x-workflow-run-id": run.runId,
    },
  });
}
