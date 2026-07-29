import { createFileRoute } from "@tanstack/react-router";
import { createSandbox } from "@autopr/agent/sandbox";
import { api } from "@autopr/backend/convex/_generated/api";
import { fetchGithubPullRequestForBranch } from "@autopr/backend/convex/lib/github_oauth";
import type { GithubPullRequestSummary } from "@autopr/backend/convex/lib/gitStatus";
import { z } from "zod";

import { convexAction, convexMutation, convexQuery } from "#/lib/convex-server";
import { findDemoRecordingMetadataInParts } from "#/lib/chat-messages";
import { pullProjectSandboxBranch } from "#/lib/daytona-project-sandbox";
import { generateThreadTitle } from "#/lib/generated-git-metadata";
import {
  getGithubOAuthToken,
  GithubConnectionError,
  requireWorkOSAuth,
  safeErrorMessage,
} from "#/lib/github-oauth-server";
import { readThreadGitStatus } from "#/lib/thread-git-status-server";
import { runThreadGitWorkflow } from "#/lib/thread-git-workflow-server";
import {
  ThreadGitMutationConflictError,
  withThreadGitMutation,
} from "#/lib/thread-git-mutation-server";

type DaytonaRecording = {
  fileName?: string;
  status?: string;
  endTime?: string;
  durationSeconds?: number;
  sizeBytes?: number;
};

type RecordingService = {
  get(recordingId: string): Promise<unknown>;
};

type RecordingPreview = {
  fileName: string;
  url: string;
  contentType: string;
  sizeBytes?: number;
  durationSeconds?: number;
};

const RECORDING_DASHBOARD_PORT = 33333;
const RECORDING_PREVIEW_EXPIRES_SECONDS = 60 * 60;
const RECORDING_READY_ATTEMPTS = 10;
const RECORDING_READY_RETRY_MS = 1_000;

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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load recording.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRecording(value: unknown): DaytonaRecording {
  if (!isRecord(value)) {
    return {};
  }

  return {
    fileName: typeof value.fileName === "string" ? value.fileName : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
    endTime: typeof value.endTime === "string" ? value.endTime : undefined,
    durationSeconds: typeof value.durationSeconds === "number" ? value.durationSeconds : undefined,
    sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : undefined,
  };
}

function isPlayableRecording(recording: DaytonaRecording) {
  return Boolean(
    recording.fileName?.trim() &&
    (!recording.status || recording.status === "completed") &&
    (recording.endTime || typeof recording.durationSeconds === "number" || typeof recording.sizeBytes === "number"),
  );
}

async function getPlayableRecordingWithRetry(recording: RecordingService, recordingId: string) {
  let latest: DaytonaRecording = {};
  let lastError: unknown;

  for (let attempt = 1; attempt <= RECORDING_READY_ATTEMPTS; attempt++) {
    try {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Recording readiness checks must be sequential retries with delay.
      latest = normalizeRecording(await recording.get(recordingId));

      if (isPlayableRecording(latest)) {
        return latest;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < RECORDING_READY_ATTEMPTS) {
      await delay(RECORDING_READY_RETRY_MS);
    }
  }

  if (lastError && !latest.fileName) {
    throw lastError;
  }

  const status = latest.status ? ` Current status: ${latest.status}.` : "";
  throw new Error(`Recording is not ready for playback yet.${status}`);
}

function recordingDashboardVideoUrl(baseUrl: string, fileName: string) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");

  url.pathname = `${basePath}/videos/${encodeURIComponent(fileName)}`;
  return url.toString();
}

async function createRecordingPreview(options: {
  sandboxId: string;
  recordingId: string;
}): Promise<RecordingPreview> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const recording = await getPlayableRecordingWithRetry(sandbox.computerUse.recording, options.recordingId);
  const fileName = recording.fileName?.trim();

  if (!fileName) {
    throw new Error("Recording file name is not available yet.");
  }

  const preview = await sandbox.getSignedPreviewUrl(RECORDING_DASHBOARD_PORT, RECORDING_PREVIEW_EXPIRES_SECONDS);

  return {
    fileName,
    url: recordingDashboardVideoUrl(preview.url, fileName),
    contentType: "video/mp4",
    sizeBytes: recording.sizeBytes,
    durationSeconds: recording.durationSeconds,
  };
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

    try {
      const worktree = await convexAction(api.projectActions.resolveThreadWorkspace, { projectId, threadId });
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
        githubToken = await getGithubOAuthToken(authState.user.id, authState.organizationId);
        const existing = await fetchGithubPullRequestForBranch(
          githubToken,
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
      return Response.json(
        {
          error: {
            code: "GIT_STATUS_REFRESH_FAILED",
            message: safeErrorMessage(error, "Could not refresh thread Git status."),
          },
        },
        { status: 502 },
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
  const sandboxId = project.sandboxId;

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
    const preview = await createRecordingPreview({
      sandboxId,
      recordingId,
    });
    const upload = await convexAction(api.recordingArtifactActions.ensureUploaded, {
      projectId,
      threadId,
      recordingId,
      sourceUrl: preview.url,
      sourceFileName: preview.fileName,
      contentType: preview.contentType,
      sizeBytes: preview.sizeBytes,
      durationSeconds: preview.durationSeconds,
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
        request: req,
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
      return Response.json({
        error: safeErrorMessage(error, "Could not generate the thread title."),
      }, { status: 500 });
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
        const [worktree, authState] = await Promise.all([
          convexAction(api.projectActions.resolveThreadWorkspace, { projectId, threadId }),
          requireWorkOSAuth(),
        ]);
        const githubToken = await getGithubOAuthToken(authState.user.id, authState.organizationId);
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
