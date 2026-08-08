import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import {
  fetchGithubPullRequests,
  GithubApiError,
  resolveGithubPullRequest,
} from "@autopr/backend/convex/lib/github_oauth";
import {
  githubRepositoriesMatch,
  parseGithubPullRequestReference,
} from "@autopr/backend/convex/lib/githubPullRequest";
import { z } from "zod";

import { convexMutation, convexQuery } from "#/lib/convex-server";
import { materializeGithubPullRequestWorktree } from "#/lib/daytona-project-sandbox";
import {
  getGithubOAuthToken,
  getGithubRepositoryTokenForFullName,
  GithubConnectionError,
  requireWorkOSAuth,
  safeErrorMessage,
} from "#/lib/github-oauth-server";

async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await convexQuery(api.projects.get, { projectId });

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    const authState = await requireWorkOSAuth();
    const token = await getGithubOAuthToken(authState.user.id, authState.organizationId);
    const pulls = await fetchGithubPullRequests(token, project.repoOwner, project.repoName);

    return Response.json({
      project: {
        projectId: project.projectId,
        repoFullName: project.repoFullName,
        githubUrl: project.githubUrl,
      },
      pulls,
    });
  } catch (error) {
    if (error instanceof GithubConnectionError) {
      return Response.json({ code: "GITHUB_NOT_CONNECTED", error: error.message }, { status: 401 });
    }

    return Response.json({ error: safeErrorMessage(error, "Could not load pull requests.") }, { status: 502 });
  }
}

const requestSchema = z.object({
  action: z.enum(["resolve", "create", "attach"]),
  reference: z.string().min(1),
  threadId: z.string().optional(),
});

async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsedBody = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return Response.json({ error: "Enter a pull request reference." }, { status: 400 });
  const project = await convexQuery(api.projects.get, { projectId });
  if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

  try {
    const reference = parseGithubPullRequestReference(parsedBody.data.reference);
    const requestedRepository = reference.owner && reference.repo
      ? `${reference.owner}/${reference.repo}`.toLowerCase()
      : project.repoFullName.toLowerCase();
    if (!githubRepositoriesMatch(requestedRepository, project.repoFullName)) {
      return Response.json({
        code: "WRONG_REPOSITORY",
        error: `PR #${reference.number} belongs to ${requestedRepository}, but this project uses ${project.repoFullName}. Select or create that project intentionally.`,
      }, { status: 409 });
    }

    const authState = await requireWorkOSAuth();
    const token = await getGithubOAuthToken(authState.user.id, authState.organizationId);
    const pullRequest = await resolveGithubPullRequest(
      token,
      reference.owner ?? project.repoOwner,
      reference.repo ?? project.repoName,
      reference.number,
    );
    if (!githubRepositoriesMatch(pullRequest.base.repositoryFullName, project.repoFullName)) {
      return Response.json({
        code: "WRONG_REPOSITORY",
        error: `PR #${reference.number} targets ${pullRequest.base.repositoryFullName}, but this project uses ${project.repoFullName}. Select or create the matching project intentionally.`,
      }, { status: 409 });
    }
    if (parsedBody.data.action === "resolve") return Response.json({ pullRequest });
    if (pullRequest.state !== "open") {
      return Response.json({
        code: pullRequest.state === "merged" ? "PULL_REQUEST_MERGED" : "PULL_REQUEST_CLOSED",
        error: `PR #${pullRequest.number} is ${pullRequest.state}. Only open pull requests can be opened in AutoPR.`,
        pullRequest,
      }, { status: 409 });
    }
    if (!pullRequest.head.branchAvailable) {
      return Response.json({
        code: "PULL_REQUEST_BRANCH_DELETED",
        error: `The source branch ${pullRequest.head.repositoryFullName}:${pullRequest.head.branch} was deleted or is unavailable.`,
        pullRequest,
      }, { status: 410 });
    }
    if (!project.sandboxId || !project.sandboxWorkDir) {
      return Response.json({ error: "The project sandbox is not ready." }, { status: 409 });
    }

    const threadResult = parsedBody.data.action === "attach"
      ? await convexMutation(api.threads.attachGithubPullRequest, {
          projectId,
          threadId: parsedBody.data.threadId ?? "",
          pullRequest,
        })
      : await convexMutation(api.threads.createFromGithubPullRequest, { projectId, pullRequest });
    const thread = await convexQuery(api.threads.get, { threadId: threadResult.threadId });
    if (!thread?.worktreePath || !thread.featureBranch) throw new Error("The thread worktree metadata is incomplete.");

    try {
      const repositoryToken = await getGithubRepositoryTokenForFullName(
        pullRequest.head.repositoryFullName,
      );
      const checkout = await materializeGithubPullRequestWorktree({
        sandboxId: project.sandboxId,
        repositoryPath: project.sandboxWorkDir,
        worktreePath: thread.worktreePath,
        localBranch: thread.featureBranch,
        pullRequestNumber: pullRequest.number,
        headCloneUrl: pullRequest.head.cloneUrl,
        headBranch: pullRequest.head.branch,
        expectedHeadSha: pullRequest.head.sha,
        githubToken: repositoryToken,
      });
      await convexMutation(api.threads.completeGithubPullRequestCheckout, {
        threadId: thread.threadId,
        worktreePath: thread.worktreePath,
        ...checkout,
      });
    } catch (error) {
      const message = safeErrorMessage(error, "Could not check out the pull request branch.");
      await convexMutation(api.threads.failGithubPullRequestCheckout, { threadId: thread.threadId, error: message });
      return Response.json({ code: "PULL_REQUEST_CHECKOUT_FAILED", error: message, threadId: thread.threadId }, { status: 409 });
    }

    return Response.json({ threadId: thread.threadId, reused: threadResult.reused, pullRequest });
  } catch (error) {
    if (error instanceof GithubConnectionError) {
      return Response.json({ code: "GITHUB_NOT_CONNECTED", error: error.message }, { status: 401 });
    }
    if (error instanceof GithubApiError) {
      const status = error.status === 404 ? 404 : error.status === 403 ? 403 : 502;
      const message = error.status === 404
        ? "The pull request was not found or your GitHub account cannot access it."
        : error.status === 403
          ? "Your GitHub account does not have permission to read this pull request."
          : error.message;
      return Response.json({ code: "GITHUB_PULL_REQUEST_UNAVAILABLE", error: message }, { status });
    }
    return Response.json({ error: safeErrorMessage(error, "Could not open the pull request.") }, { status: 400 });
  }
}

export const Route = createFileRoute("/api/project/$projectId/pulls")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: any }) => GET(request, { params: Promise.resolve(params) } as any),
      POST: async ({ request, params }: { request: Request; params: any }) => POST(request, { params: Promise.resolve(params) } as any),
    },
  },
});
