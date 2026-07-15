import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { createGithubPullRequest } from "@autopr/backend/convex/lib/github_oauth";
import { z } from "zod";

import { convexAction, convexMutation, convexQuery } from "#/lib/convex-server";
import { commitAndPushProjectSandboxChanges, SandboxNoChangesError } from "#/lib/daytona-project-sandbox";
import {
  getGithubOAuthToken,
  getGithubUserIdentity,
  GithubConnectionError,
  requireWorkOSAuth,
  safeErrorMessage,
} from "#/lib/github-oauth-server";

const requestSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  body: z.string().trim().max(5000).optional(),
  draft: z.boolean().optional(),
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
  return Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
  ]).then(async ([project, thread]) => {
    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    if (!thread || thread.projectId !== projectId) {
      return Response.json({ error: "Thread not found." }, { status: 404 });
    }

    if (thread.pullRequestStatus === "created" && thread.pullRequestUrl) {
      return Response.json({
        status: "created",
        url: thread.pullRequestUrl,
        number: thread.pullRequestNumber,
        branch: thread.pullRequestBranch,
      });
    }

    if (project.sandboxStatus !== "ready" || !project.sandboxId) {
      return Response.json({ error: "Project sandbox is not ready yet." }, { status: 409 });
    }

    const title = parsed.data.title || thread.title || "AutoPR changes";
    const body =
      parsed.data.body ||
      [`Created from AutoPR thread \`${threadId}\`.`, "", "This PR contains the changes currently staged in the thread sandbox."].join("\n");

    try {
      const authState = await requireWorkOSAuth();
      const token = await getGithubOAuthToken(authState.user.id, authState.organizationId);
      const gitIdentity = await getGithubUserIdentity(authState.user, token);
      const worktree = await convexAction(api.projectActions.ensureThreadWorktree, {
        projectId,
        threadId,
      });
      const baseBranch = worktree.baseBranch;
      const branch = worktree.featureBranch;
      const existingFailedBranch = thread.pullRequestStatus === "failed" ? thread.pullRequestBranch : undefined;
      await convexMutation(api.threads.markPullRequestCreating, { threadId, branch });

      try {
        try {
          const commit = await commitAndPushProjectSandboxChanges({
            sandboxId: project.sandboxId,
            githubToken: token,
            githubUsername: gitIdentity.username,
            authorName: gitIdentity.name,
            authorEmail: gitIdentity.email,
            branch,
            baseBranch,
            commitMessage: title,
            repoName: project.repoName,
            sandboxWorkDir: worktree.worktreePath,
          });
          await convexMutation(api.threads.markChangesCommitted, {
            threadId,
            status: "pushed",
            branch,
            commitSha: commit.commitSha,
            commitMessage: title,
          });
        } catch (error) {
          if (!(error instanceof SandboxNoChangesError && existingFailedBranch === branch)) {
            throw error;
          }
        }

        const pull = await createGithubPullRequest(token, project.repoOwner, project.repoName, {
          title,
          head: branch,
          base: baseBranch,
          body,
          draft: parsed.data.draft ?? false,
        });

        await convexMutation(api.threads.markPullRequestCreated, {
          threadId,
          branch,
          url: pull.htmlUrl,
          number: pull.number,
        });

        return Response.json({ status: "created", url: pull.htmlUrl, number: pull.number, branch });
      } catch (error) {
        const message = safeErrorMessage(error, "Could not create pull request.");
        await convexMutation(api.threads.markPullRequestFailed, { threadId, error: message });

        return Response.json(
          { error: message },
          { status: error instanceof SandboxNoChangesError ? 409 : 500 },
        );
      }
    } catch (error) {
      if (error instanceof GithubConnectionError) {
        return Response.json({ code: "GITHUB_NOT_CONNECTED", error: error.message }, { status: 401 });
      }

      return Response.json({ error: safeErrorMessage(error, "Could not create pull request.") }, { status: 500 });
    }
  });
}

export const Route = createFileRoute("/api/project/$projectId/thread/$threadId/pull-request")({
  server: {
    handlers: { POST: async ({ request, params }: { request: Request; params: any }) => POST(request, { params: Promise.resolve(params) } as any) },
  },
});
