import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";

import { convexMutation, convexQuery } from "#/lib/convex-server";

async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {
  const { projectId, threadId } = await params;

  const thread = await convexQuery(api.threads.get, { threadId });

  if (!thread || thread.projectId !== projectId) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }

  await convexMutation(api.threads.remove, { threadId });

  return Response.json({ projectId, threadId });
}

export const Route = createFileRoute("/api/project/$projectId/thread/$threadId")({
  server: {
    handlers: { DELETE: async ({ request, params }: { request: Request; params: any }) => DELETE(request, { params: Promise.resolve(params) } as any) },
  },
});
