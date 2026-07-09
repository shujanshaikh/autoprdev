import { createFileRoute } from "@tanstack/react-router";
import { createUIMessageStreamResponse } from "ai";

import {
  finishedUIMessageStream,
  isTriggerNotFoundError,
  readAgentUIMessageStream,
} from "#/lib/trigger-agent-stream-server";

async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = new URL(request.url).searchParams.get("startIndex");
  const startIndex = value === null ? 0 : Number.parseInt(value, 10);

  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json({ error: "Invalid startIndex." }, { status: 400 });
  }

  try {
    return createUIMessageStreamResponse({
      stream: await readAgentUIMessageStream(id, startIndex, request.signal),
    });
  } catch (error) {
    if (!isTriggerNotFoundError(error)) {
      throw error;
    }

    return createUIMessageStreamResponse({
      stream: finishedUIMessageStream(),
    });
  }
}

export const Route = createFileRoute("/api/agent/$id/stream")({
  server: {
    handlers: { GET: async ({ request, params }: { request: Request; params: any }) => GET(request, { params: Promise.resolve(params) } as any) },
  },
});
