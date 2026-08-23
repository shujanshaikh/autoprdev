import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { createUIMessageStreamResponse } from "ai";

import { convexQuery } from "#/lib/convex-server";
import {
  isTriggerNotFoundError,
  lookupTriggerAgentRun,
  reconcileThreadWithTriggerRun,
} from "#/lib/trigger-agent-run-server";
import {
  emptyUIMessageStream,
  finishedUIMessageStream,
  isTriggerRunVisibilityPending,
  readAgentUIMessageStream,
} from "#/lib/trigger-agent-stream-server";
import { agentProjectTag, agentThreadTag } from "#/lib/trigger-agent-contract";

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

  const requiredTags = [agentProjectTag(projectId), agentThreadTag(threadId)];
  const lookup = await lookupTriggerAgentRun(runId, requiredTags);

  if (lookup.status === "mismatch") {
    await reconcileThreadWithTriggerRun(threadId, runId, null);
    return Response.json({ error: "Agent run not found." }, { status: 404 });
  }

  if (lookup.status === "not-found") {
    if (isTriggerRunVisibilityPending(thread, runId)) {
      // A newly created Trigger run can take a moment to become visible to a
      // separate read request. Keep the indexed client attached during that gap.
      return createUIMessageStreamResponse({ stream: emptyUIMessageStream() });
    }
    await reconcileThreadWithTriggerRun(threadId, runId, null);
    return createUIMessageStreamResponse({
      stream: finishedUIMessageStream(),
    });
  }

  try {
    return createUIMessageStreamResponse({
      stream: await readAgentUIMessageStream(
        runId,
        startIndex,
        request.signal,
        async (terminalRun) => {
          await reconcileThreadWithTriggerRun(threadId, runId, terminalRun);
        },
      ),
    });
  } catch (error) {
    if (!isTriggerNotFoundError(error)) {
      throw error;
    }

    const latestLookup = await lookupTriggerAgentRun(runId, requiredTags);

    if (latestLookup.status === "found" && !latestLookup.run.isCompleted) {
      return createUIMessageStreamResponse({
        stream: emptyUIMessageStream(),
      });
    }

    if (latestLookup.status === "not-found" && isTriggerRunVisibilityPending(thread, runId)) {
      return createUIMessageStreamResponse({ stream: emptyUIMessageStream() });
    }

    await reconcileThreadWithTriggerRun(
      threadId,
      runId,
      latestLookup.status === "found" ? latestLookup.run : null,
    );

    if (latestLookup.status === "mismatch") {
      return Response.json({ error: "Agent run not found." }, { status: 404 });
    }

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
