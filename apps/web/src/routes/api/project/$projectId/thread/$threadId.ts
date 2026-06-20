import { createFileRoute } from "@tanstack/react-router";
import { createSandbox } from "@autopr/agent/sandbox";
import { api } from "@autopr/backend/convex/_generated/api";
import { z } from "zod";

import { convexAction, convexMutation, convexQuery } from "#/lib/convex-server";
import { findDemoRecordingMetadataInParts } from "#/lib/chat-messages";
import {
  commitPreparedProjectSandboxChanges,
  prepareProjectSandboxCommit,
  SandboxNoChangesError,
} from "#/lib/daytona-project-sandbox";
import {
  getGithubOAuthToken,
  getGithubUserIdentity,
  GithubConnectionError,
  requireWorkOSAuth,
  safeErrorMessage,
} from "#/lib/github-oauth-server";

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

const postRequestSchema = z.object({
  action: z.literal("commit"),
  push: z.boolean().optional(),
});

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

function workOSCommitIdentity(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}) {
  const email = user.email?.trim();

  if (!email) {
    throw new Error("Could not determine your commit author email.");
  }

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || email.split("@")[0] || email;

  return { name, email };
}

async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; threadId: string }> },
) {
  const { searchParams } = new URL(req.url);
  const recordingId = searchParams.get("recordingId")?.trim();
  const shouldPrepare = searchParams.get("prepare") === "1";

  if (!recordingId) {
    return Response.json({ error: "Missing recordingId." }, { status: 400 });
  }

  const { projectId, threadId } = await params;
  const [project, thread, messages] = await Promise.all([
    convexQuery(api.projects.get, { projectId }),
    convexQuery(api.threads.get, { threadId }),
    convexQuery(api.messages.listByThread, { threadId }),
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
    const preview = await createRecordingPreview({
      sandboxId: project.sandboxId,
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

  await convexMutation(api.threads.remove, { threadId });

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

  if (project.sandboxStatus !== "ready" || !project.sandboxId) {
    return Response.json({ error: "Project sandbox is not ready." }, { status: 409 });
  }

  if (thread.commitStatus) {
    return Response.json({
      error: thread.commitStatus === "pushed"
        ? "Changes for this thread have already been committed and pushed."
        : "Changes for this thread have already been committed.",
      status: thread.commitStatus,
      branch: thread.commitBranch,
      commitSha: thread.commitSha,
      commitMessage: thread.commitMessage,
    }, { status: 409 });
  }

  try {
    const authState = await requireWorkOSAuth();
    let gitIdentity = workOSCommitIdentity(authState.user);
    let githubUsername: string | undefined;
    let githubToken: string | undefined;

    if (parsed.data.push) {
      githubToken = await getGithubOAuthToken(authState.user.id, authState.organizationId);
      const githubIdentity = await getGithubUserIdentity(authState.user, githubToken);
      gitIdentity = {
        name: githubIdentity.name,
        email: githubIdentity.email,
      };
      githubUsername = githubIdentity.username;
    }

    const prepared = await prepareProjectSandboxCommit({
      sandboxId: project.sandboxId,
      repoName: project.repoName,
      sandboxWorkDir: project.sandboxWorkDir,
    });
    const commitMessage = await convexAction(api.commitMessages.generate, {
      projectId,
      branch: prepared.branch,
      status: prepared.status,
      diff: prepared.diff,
    });
    const result = await commitPreparedProjectSandboxChanges({
      sandboxId: project.sandboxId,
      commitMessage,
      authorName: gitIdentity.name,
      authorEmail: gitIdentity.email,
      push: parsed.data.push,
      githubUsername,
      githubToken,
      repoName: project.repoName,
      sandboxWorkDir: project.sandboxWorkDir,
    });
    const status = result.pushed ? "pushed" : "committed";

    await convexMutation(api.threads.markChangesCommitted, {
      threadId,
      status,
      branch: result.branch,
      commitSha: result.commitSha,
      commitMessage,
    });

    return Response.json({
      status,
      branch: result.branch,
      commitSha: result.commitSha,
      commitMessage,
    });
  } catch (error) {
    if (error instanceof SandboxNoChangesError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    if (error instanceof GithubConnectionError) {
      return Response.json({ error: error.message }, { status: 401 });
    }

    return Response.json({ error: safeErrorMessage(error, "Could not commit sandbox changes.") }, { status: 500 });
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
