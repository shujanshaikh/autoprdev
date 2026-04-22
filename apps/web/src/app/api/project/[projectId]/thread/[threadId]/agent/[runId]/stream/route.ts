import { api } from "@autopr/backend/convex/_generated/api";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { getRun } from "workflow/api";

import { ConvexAuthConfigurationError, getAuthenticatedConvexClient } from "@/lib/convex-server";

function parseStartIndex(request: Request) {
  const { searchParams } = new URL(request.url);
  const startIndexParam = searchParams.get("startIndex");

  return startIndexParam ? Number.parseInt(startIndexParam, 10) : undefined;
}

function isWorkflowRunNotFoundError(error: unknown) {
  return error instanceof Error && error.name === "WorkflowRunNotFoundError";
}

function finishedStream() {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "finish" });
      controller.close();
    },
  });
}

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; threadId: string; runId: string }>;
  },
) {
  let convex: Awaited<ReturnType<typeof getAuthenticatedConvexClient>>;

  try {
    convex = await getAuthenticatedConvexClient();
  } catch (error) {
    if (error instanceof ConvexAuthConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }

    throw error;
  }

  if (!convex) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId: projectIdParam, threadId: threadIdParam, runId } = await params;
  const projectId = projectIdParam;
  const threadId = threadIdParam;
  const [project, thread] = await Promise.all([
    convex.client.query(api.projects.get, { projectId }),
    convex.client.query(api.threads.get, { threadId }),
  ]);

  if (!project || !thread || thread.projectId !== projectId) {
    return Response.json({ error: "Project or thread not found." }, { status: 404 });
  }

  try {
    const readable = getRun(runId).getReadable({ startIndex: parseStartIndex(request) });
    const tailIndex = await readable.getTailIndex();

    return createUIMessageStreamResponse({
      stream: readable,
      headers: {
        "x-workflow-stream-tail-index": String(tailIndex),
      },
    });
  } catch (error) {
    if (!isWorkflowRunNotFoundError(error)) {
      throw error;
    }

    await convex.client.mutation(api.threads.markRunFinished, {
      threadId,
      runId,
    });

    return createUIMessageStreamResponse({
      stream: finishedStream(),
      headers: {
        "x-workflow-stream-tail-index": "-1",
      },
    });
  }
}
