import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { safeErrorMessage } from "#/lib/github-oauth-server";
import { runThreadGitWorkflow } from "#/lib/thread-git-workflow-server";
import { ThreadGitMutationConflictError } from "#/lib/thread-git-mutation-server";

const requestSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  body: z.string().trim().max(5000).optional(),
  draft: z.boolean().optional(),
  operationId: z.uuid().optional(),
  action: z.enum(["create_pr", "push_create_pr", "commit_push_create_pr"]).optional(),
});

async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid pull request details." }, { status: 400 });
  }

  const { projectId, threadId } = await params;
  try {
    return await runThreadGitWorkflow({
      request: req,
      projectId,
      threadId,
      input: {
        operationId: parsed.data.operationId ?? crypto.randomUUID(),
        action: parsed.data.action ?? "create_pr",
        title: parsed.data.title,
        body: parsed.data.body,
        draft: parsed.data.draft,
      },
    });
  } catch (error) {
    if (error instanceof ThreadGitMutationConflictError) {
      return Response.json({
        error: { code: "GIT_OPERATION_CONFLICT", message: error.message },
      }, { status: 409 });
    }
    return Response.json({
      error: { code: "GIT_OPERATION_FAILED", message: safeErrorMessage(error, "Could not start the Git operation.") },
    }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/project/$projectId/thread/$threadId/pull-request")({
  server: {
    handlers: { POST: async ({ request, params }: { request: Request; params: any }) => POST(request, /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ { params: Promise.resolve(params) } as any) },
  },
});
