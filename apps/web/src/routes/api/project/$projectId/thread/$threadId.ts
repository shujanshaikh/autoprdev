import { createFileRoute } from "@tanstack/react-router";
import { api } from "@autopr/backend/convex/_generated/api";
import { fetchGithubPullRequestForBranch } from "@autopr/backend/convex/lib/github_oauth";
import type { GithubPullRequestSummary } from "@autopr/backend/convex/lib/gitStatus";
import { APICallError } from "ai";
import { z } from "zod";

import { convexAction, convexMutation, convexQuery } from "#/lib/convex-server";
import { findDemoRecordingMetadataInParts } from "#/lib/chat-messages";
import { pullProjectSandboxBranch } from "#/lib/daytona-project-sandbox";
import { generateThreadTitle } from "#/lib/generated-git-metadata";
import {
  getGithubOAuthToken,
  getGithubRepositoryToken,
  getGithubRepositoryTokenForFullName,
  GithubConnectionError,
  requireWorkOSAuth,
  safeErrorMessage,
} from "#/lib/github-oauth-server";
import {
  readThreadGitStatus,
  SandboxRuntimeNotStartedError,
} from "#/lib/thread-git-status-server";
import { runThreadGitWorkflow } from "#/lib/thread-git-workflow-server";
import {
  ThreadGitMutationConflictError,
  withThreadGitMutation,
} from "#/lib/thread-git-mutation-server";
import {
  persistedThreadWorkspace,
  resolveThreadWorkspaceCoordinates,
} from "#/lib/thread-workspace-server";

const postRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate_title"),
    message: z.string().trim().min(1).max(8_000),
  }),
  z.object({
    action: z.enum([
      "commit",
      "push",
      "create_pr",
      "commit_push",
      "push_create_pr",
      "commit_push_create_pr",
      "pull",
    ]),
    operationId: z.uuid().optional(),
    push: z.boolean().optional(),
    commitMessage: z.string().trim().min(1).max(500).optional(),
  }),
]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load recording.";
}

async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {
  const { searchParams } = new URL(req.url);
  const recordingId = searchParams.get("recordingId")?.trim();
  const shouldPrepare = searchParams.get("prepare") === "1";

  if (searchParams.get("gitStatus") === "1") {
    const { projectId, threadId } = await params;
    const [project, thread] = await Promise.all([
      convexQuery(api.projects.get, { projectId }),
      convexQuery(api.threads.get, { threadId }),
    ]);

    if (!project || !thread || thread.projectId !== projectId) {
      return Response.json(
        { error: { code: "THREAD_NOT_FOUND", message: "Thread not found." } },
        { status: 404 },
      );
    }
    if (project.sandboxStatus !== "ready" || !project.sandboxId) {
      return Response.json(
        { error: { code: "PROJECT_SANDBOX_NOT_READY", message: "Project sandbox is not ready." } },
        { status: 409 },
      );
    }

    if (project.sandboxRuntimeStatus !== "started") {
      return Response.json(
        {
          error: {
            code: "SANDBOX_RUNTIME_NOT_STARTED",
            message: "Start the project workspace before refreshing Git status.",
          },
        },
        { status: 409 },
      );
    }

    let worktree;
    try {
      // Checkout-mode threads deliberately have no persisted workspace: the
      // branch can be changed from a terminal, so it must be inspected live.
      // Worktree-mode threads also use this path for first-time provisioning.
      worktree = await resolveThreadWorkspaceCoordinates(project, thread, () =>
        convexAction(api.projectActions.resolveThreadWorkspace, {
          projectId,
          threadId,
        }),
      );
    } catch (error) {
      return Response.json(
        {
          error: {
            code: "THREAD_WORKSPACE_NOT_READY",
            message: safeErrorMessage(error, "Could not prepare the thread workspace."),
          },
        },
        { status: 409 },
      );
    }

    try {
      let githubToken: string | undefined;
        let pullRequest: GithubPullRequestSummary | undefined = thread.pullRequestNumber && thread.pullRequestUrl
        ? {
            number: thread.pullRequestNumber,
            title: thread.githubPullRequestTitle ?? thread.title,
            url: thread.pullRequestUrl,
            state: thread.githubPullRequestState ?? "unknown",
            draft: thread.githubPullRequestDraft ?? false,
          }
        : undefined;

      try {
        const authState = await requireWorkOSAuth();
        const oauthToken = await getGithubOAuthToken(authState.user.id, authState.organizationId);
        const existing = await fetchGithubPullRequestForBranch(
          oauthToken,
          project.repoOwner,
          project.repoName,
          worktree.featureBranch,
        );
        if (existing) {
          pullRequest = {
            number: existing.number,
            title: existing.title,
            url: existing.htmlUrl,
            state: existing.state,
            draft: existing.draft,
          };
        }
        githubToken = await getGithubRepositoryToken(project.repoOwner, project.repoName);
      } catch (error) {
        if (!(error instanceof GithubConnectionError)) {
          // PR discovery is best-effort and must not hide local Git status.
          console.warn("Could not discover the thread pull request", safeErrorMessage(error, "GitHub unavailable."));
        }
      }

      const status = await readThreadGitStatus({
        sandboxId: project.sandboxId,
        worktreePath: worktree.worktreePath,
        baseBranch: worktree.baseBranch,
        repositoryUrl: project.cloneUrl,
        refreshRemote: searchParams.get("refresh") !== "0",
        githubToken,
        pullRequest,
      });
      await convexMutation(api.threads.updateGitStatus, { threadId, status });

      return Response.json(
        { status },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (error) {
      const runtimeStopped = error instanceof SandboxRuntimeNotStartedError;
      return Response.json(
        {
          error: {
            code: runtimeStopped ? error.code : "GIT_STATUS_REFRESH_FAILED",
            message: runtimeStopped
              ? "Start the project workspace before refreshing Git status."
              : safeErrorMessage(error, "Could not refresh thread Git status."),
          },
        },
        { status: runtimeStopped ? 409 : 502 },
      );
    }
  }

  if (!recordingId) {
    return Response.json({ error: "Missing recordingId." }, { status: 400 });
  }

  const { projectId, threadId } = await params;
  const [project, thread, messages] = await Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
    convexAction(api.messages.listByThreadHydrated, { threadId }),
  ]);

  if (!project || !thread || thread.projectId !== projectId) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }

  if (project.sandboxStatus !== "ready" || !project.sandboxId) {
    return Response.json({ error: "Project sandbox is not ready." }, { status: 409 });
  }

  let recordingMetadata: ReturnType<typeof findDemoRecordingMetadataInParts> = null;
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    recordingMetadata = findDemoRecordingMetadataInParts(message.parts, recordingId);
    if (recordingMetadata) {
      break;
    }
  }

  if (!recordingMetadata) {
    return Response.json({ error: "Recording not found on this thread." }, { status: 404 });
  }

  try {
    const upload = await convexAction(api.recordingArtifactActions.ensureUploaded, {
      projectId,
      threadId,
      recordingId,
    });

    if (shouldPrepare) {
      return Response.json(
        {
          status: upload.status,
          url: upload.url,
        },
        {
          headers: {
            "Cache-Control": "private, no-store",
          },
        },
      );
    }

    return new Response(null, {
      status: 307,
      headers: {
        Location: upload.url,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (shouldPrepare) {
      return Response.json(
        {
          status: "preparing",
          error: errorMessage(error),
        },
        {
          status: 202,
          headers: {
            "Cache-Control": "private, no-store",
          },
        },
      );
    }

    return Response.json({ error: errorMessage(error) }, { status: 502 });
  }
}

async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {
  const { projectId, threadId } = await params;

  const thread = await convexQuery(api.threads.get, { threadId });

  if (!thread || thread.projectId !== projectId) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }

  try {
    await convexAction(api.projectActions.removeThreadWithWorktree, { projectId, threadId });
  } catch (error) {
    return Response.json(
      { error: safeErrorMessage(error, "Could not safely clean up the thread worktree.") },
      { status: 409 },
    );
  }

  return Response.json({ projectId, threadId });
}

async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {
  const parsed = postRequestSchema.safeParse(await req.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: "Invalid thread action." }, { status: 400 });
  }

  const { projectId, threadId } = await params;
  const [project, thread] = await Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
  ]);

  if (!project || !thread || thread.projectId !== projectId) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }

  if (parsed.data.action === "generate_title") {
    try {
      const title = await generateThreadTitle({
        // Codex auth only needs cookies/headers. Recreate the request from
        // primitives so framework-owned Fetch objects never cross into the
        // Node/Undici auth provider after their JSON body has been consumed.
        request: new Request(req.url, { headers: new Headers(req.headers) }),
        projectId,
        threadId,
        message: parsed.data.message,
      });
      const updated = await convexMutation(api.threads.updateGeneratedTitle, {
        threadId,
        title,
      });
      return Response.json({ title, updated });
    } catch (error) {
      const status = APICallError.isInstance(error)
        && error.statusCode
        && error.statusCode >= 400
        && error.statusCode <= 599
        ? error.statusCode
        : 500;
      return Response.json({
        error: safeErrorMessage(error, "Could not generate the thread title."),
      }, { status });
    }
  }

  if (project.sandboxStatus !== "ready" || !project.sandboxId) {
    return Response.json({ error: "Project sandbox is not ready." }, { status: 409 });
  }
  const sandboxId = project.sandboxId;

  const requestedAction = parsed.data.action === "commit" && parsed.data.push
    ? "commit_push"
    : parsed.data.action;

  if (requestedAction !== "pull") {
    try {
      return await runThreadGitWorkflow({
        request: req,
        projectId,
        threadId,
        input: {
          operationId: parsed.data.operationId ?? crypto.randomUUID(),
          action: requestedAction,
          commitMessage: parsed.data.commitMessage,
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

  try {
    return await withThreadGitMutation({
      threadId,
      action: "pull",
      run: async () => {
        const persistedWorkspace = persistedThreadWorkspace(project, thread);
        const [worktree, authState] = await Promise.all([
          persistedWorkspace
            ? Promise.resolve(persistedWorkspace)
            : convexAction(api.projectActions.resolveThreadWorkspace, { projectId, threadId }),
          requireWorkOSAuth(),
        ]);
        await getGithubOAuthToken(authState.user.id, authState.organizationId);
        const githubToken = thread.githubPullRequestHeadRepository
          ? await getGithubRepositoryTokenForFullName(thread.githubPullRequestHeadRepository)
          : await getGithubRepositoryToken(project.repoOwner, project.repoName);
        const result = await pullProjectSandboxBranch({
          sandboxId,
          branch: worktree.featureBranch,
          githubToken,
          repoName: project.repoName,
          sandboxWorkDir: worktree.worktreePath,
          target: thread.githubPullRequestHeadCloneUrl && thread.githubPullRequestHeadBranch
            ? {
                remoteUrl: thread.githubPullRequestHeadCloneUrl,
                remoteBranch: thread.githubPullRequestHeadBranch,
              }
            : undefined,
        });
        await convexMutation(api.threads.invalidateGitStatus, {
          threadId,
          reason: "pull_rebase",
        });
        return Response.json({ status: "updated", ...result });
      },
    });
  } catch (error) {
    if (error instanceof ThreadGitMutationConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    if (error instanceof GithubConnectionError) {
      return Response.json({ error: error.message }, { status: 401 });
    }

    return Response.json({ error: safeErrorMessage(error, "Could not update the thread branch.") }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/project/$projectId/thread/$threadId")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: any }) =>
        GET(request, { params: Promise.resolve(params) } as any),
      POST: async ({ request, params }: { request: Request; params: any }) =>
        POST(request, { params: Promise.resolve(params) } as any),
      DELETE: async ({ request, params }: { request: Request; params: any }) =>
        DELETE(request, { params: Promise.resolve(params) } as any),
    },
  },
});
