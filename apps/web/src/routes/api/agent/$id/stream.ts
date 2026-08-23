import { createFileRoute } from "@tanstack/react-router";
import { createUIMessageStreamResponse } from "ai";
import { getAuthkit } from "@workos/authkit-tanstack-react-start";

import { emptyUIMessageStream, finishedUIMessageStream, readAgentUIMessageStream } from "#/lib/trigger-agent-stream-server";
import { isTriggerNotFoundError, lookupTriggerAgentRun } from "#/lib/trigger-agent-run-server";
import { agentUserTag } from "#/lib/trigger-agent-contract";

async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = new URL(request.url).searchParams.get("startIndex");
  const startIndex = value === null ? 0 : Number.parseInt(value, 10);

  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json({ error: "Invalid startIndex." }, { status: 400 });
  }

  const authkit = await getAuthkit();
  const session = await authkit.getSession(request);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requiredTags = [agentUserTag(session.user.id)];
  const lookup = await lookupTriggerAgentRun(id, requiredTags);

  if (lookup.status === "mismatch") {
    return Response.json({ error: "Agent run not found." }, { status: 404 });
  }

  if (lookup.status === "not-found") {
    return createUIMessageStreamResponse({
      stream: finishedUIMessageStream(),
    });
  }

  try {
    return createUIMessageStreamResponse({
      stream: await readAgentUIMessageStream(id, startIndex, request.signal),
    });
  } catch (error) {
    if (!isTriggerNotFoundError(error)) {
      throw error;
    }

    const latestLookup = await lookupTriggerAgentRun(id, requiredTags);

    if (latestLookup.status === "found" && !latestLookup.run.isCompleted) {
      return createUIMessageStreamResponse({
        stream: emptyUIMessageStream(),
      });
    }

    if (latestLookup.status === "mismatch") {
      return Response.json({ error: "Agent run not found." }, { status: 404 });
    }

    return createUIMessageStreamResponse({
      stream: finishedUIMessageStream(),
    });
  }
}

export const Route = createFileRoute("/api/agent/$id/stream")({
  server: {
    handlers: { GET: async ({ request, params }: { request: Request; params: any }) => GET(request, /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ { params: Promise.resolve(params) } as any) },
  },
});
