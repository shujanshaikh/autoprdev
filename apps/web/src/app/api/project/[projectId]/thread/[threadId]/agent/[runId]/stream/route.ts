import { api } from "@autopr/backend/convex/_generated/api";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { getRun } from "workflow/api";

import { convexMutation, convexQuery } from "@/lib/convex-server";

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
  const startIndex = parseStartIndex(request);
  if (startIndex !== undefined && Number.isNaN(startIndex)) {
    return Response.json({ error: "Invalid startIndex." }, { status: 400 });
  }

  const { projectId: projectIdParam, threadId: threadIdParam, runId } = await params;
  const projectId = projectIdParam;
  const threadId = threadIdParam;
  return Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
  ]).then(async ([project, thread]) => {
    if (!project || !thread || thread.projectId !== projectId) {
      return Response.json({ error: "Project or thread not found." }, { status: 404 });
    }

    try {
      const readable = getRun(runId).getReadable({ startIndex });
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

      await convexMutation(api.threads.markRunFinished, {
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
  });
}
