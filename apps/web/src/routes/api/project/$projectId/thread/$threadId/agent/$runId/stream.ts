import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { runs } from "@trigger.dev/sdk";
import { createUIMessageStreamResponse } from "ai";

import { convexMutation, convexQuery } from "#/lib/convex-server";
import {
  emptyUIMessageStream,
  finishedUIMessageStream,
  isTriggerNotFoundError,
  readAgentUIMessageStream,
} from "#/lib/trigger-agent-stream-server";

function parseStartIndex(request: Request) {
  const value = new URL(request.url).searchParams.get("startIndex");
  if (value === null) {
    return 0;
  }

  const startIndex = Number.parseInt(value, 10);
  return Number.isSafeInteger(startIndex) && startIndex >= 0 ? startIndex : null;
}

async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; threadId: string; runId: string }>;
  },
) {
  const startIndex = parseStartIndex(request);
  if (startIndex === null) {
    return Response.json({ error: "Invalid startIndex." }, { status: 400 });
  }

  const { projectId, threadId, runId } = await params;
  const [project, thread] = await Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
  ]);

  if (!project || !thread || thread.projectId !== projectId) {
    return Response.json({ error: "Project or thread not found." }, { status: 404 });
  }

  try {
    return createUIMessageStreamResponse({
      stream: await readAgentUIMessageStream(
        runId,
        startIndex,
        request.signal,
        async () => {
          await convexMutation(api.threads.markRunFinished, { threadId, runId });
        },
      ),
    });
  } catch (error) {
    if (!isTriggerNotFoundError(error)) {
      throw error;
    }

    const run = await runs.retrieve(runId).catch((retrieveError: unknown) => {
      if (isTriggerNotFoundError(retrieveError)) {
        return null;
      }
      throw retrieveError;
    });

    if (run && !run.isCompleted) {
      return createUIMessageStreamResponse({
        stream: emptyUIMessageStream(),
      });
    }

    await convexMutation(api.threads.markRunFinished, {
      threadId,
      runId,
    });

    return createUIMessageStreamResponse({
      stream: finishedUIMessageStream(),
    });
  }
}

export const Route = createFileRoute("/api/project/$projectId/thread/$threadId/agent/$runId/stream")({
  server: {
    handlers: { GET: async ({ request, params }: { request: Request; params: any }) => GET(request, { params: Promise.resolve(params) } as any) },
  },
});
