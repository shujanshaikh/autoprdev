import { createFileRoute } from "@tanstack/react-router";
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { getRun } from "workflow/api";

function finishedStream() {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "finish" });
      controller.close();
    },
  });
}

function isWorkflowRunNotFoundError(error: unknown) {
  return error instanceof Error && error.name === "WorkflowRunNotFoundError";
}

async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const startIndexParam = searchParams.get("startIndex");
  const startIndex = startIndexParam ? Number.parseInt(startIndexParam, 10) : undefined;

  try {
    const run = getRun(id);
    const readable = run.getReadable({ startIndex });
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

    return createUIMessageStreamResponse({
      stream: finishedStream(),
      headers: {
        "x-workflow-stream-tail-index": "-1",
      },
    });
  }
}

export const Route = createFileRoute("/api/agent/$id/stream")({
  server: {
    handlers: { GET: async ({ request, params }: { request: Request; params: any }) => GET(request, { params: Promise.resolve(params) } as any) },
  },
});
