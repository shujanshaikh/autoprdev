import { api } from "@autopr/backend/convex/_generated/api";
import { createGithubPullRequest } from "@autopr/backend/convex/lib/github_oauth";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { convexMutation, convexQuery } from "@/lib/convex-server";
import { commitAndPushProjectSandboxChanges, SandboxNoChangesError } from "@/lib/daytona-project-sandbox";
import {
  authenticatedGithubCloneUrl,
  getGithubOAuthToken,
  GithubConnectionError,
  safeErrorMessage,
} from "@/lib/github-oauth-server";

const requestSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  body: z.string().trim().max(5000).optional(),
  branch: z.string().trim().min(1).max(120),
  draft: z.boolean().optional(),
});

function autoprBranchName(value: string) {
  const withoutPrefix = value.trim().replace(/^autopr[/-]*/i, "");
  const slug = withoutPrefix
    .replace(/\\/g, "/")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\/+/g, "/")
    .replace(/^[/.-]+|[/.-]+$/g, "")
    .replace(/\.lock$/i, "-lock")
    .slice(0, 96);

  return slug ? `autopr/${slug}` : undefined;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {
  const authState = await auth();

  if (!authState.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid pull request details." }, { status: 400 });
  }

  const { projectId, threadId } = await params;
  const [project, thread] = await Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
  ]);

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

  const baseBranch = project.currentBranch ?? project.repoBranch ?? project.defaultBranch;
  if (!baseBranch) {
    return Response.json({ error: "Project base branch is unknown." }, { status: 409 });
  }

  const title = parsed.data.title || thread.title || "AutoPR changes";
  const requestedBranch = autoprBranchName(parsed.data.branch);
  if (!requestedBranch) {
    return Response.json({ error: "Enter a branch name after autopr/." }, { status: 400 });
  }

  const existingFailedBranch = thread.pullRequestStatus === "failed" ? thread.pullRequestBranch : undefined;
  const branch = requestedBranch;
  const body =
    parsed.data.body ||
    [`Created from AutoPR thread \`${threadId}\`.`, "", "This PR contains the changes currently staged in the thread sandbox."].join("\n");

  try {
    const token = await getGithubOAuthToken(authState.userId);
    await convexMutation(api.threads.markPullRequestCreating, { threadId, branch });

    try {
      try {
        await commitAndPushProjectSandboxChanges({
          sandboxId: project.sandboxId,
          authenticatedCloneUrl: authenticatedGithubCloneUrl(token, project.repoOwner, project.repoName),
          branch,
          baseBranch,
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
}
