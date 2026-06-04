import { createFileRoute } from "@tanstack/react-router";
import { createReadStream } from "node:fs";
import { open, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
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
  sizeBytes?: number;
};

type ByteRange = {
  start: number;
  end: number;
};

const RECORDING_DOWNLOAD_ATTEMPTS = 4;
const RECORDING_DOWNLOAD_RETRY_MS = 700;

const postRequestSchema = z.object({
  action: z.literal("commit"),
  push: z.boolean().optional(),
});

function safeRecordingFilename(recordingId: string, fileName?: string) {
  const candidate = fileName?.trim() || `${recordingId}.mp4`;
  return candidate.replace(/[^a-zA-Z0-9._-]/g, "_") || `${recordingId}.mp4`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contentTypeFromFilename(filename: string) {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".webm")) {
    return "video/webm";
  }

  if (lower.endsWith(".mov")) {
    return "video/quicktime";
  }

  return "video/mp4";
}

async function sniffRecordingContentType(tempPath: string, filename: string) {
  const handle = await open(tempPath, "r");

  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);

    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return "video/webm";
    }

    if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
      return "video/mp4";
    }
  } finally {
    await handle.close();
  }

  return contentTypeFromFilename(filename);
}

async function downloadRecordingWithRetry(recording: {
  download: (recordingId: string, path: string) => Promise<unknown>;
}, recordingId: string, tempPath: string) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= RECORDING_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      await recording.download(recordingId, tempPath);
      const fileStat = await stat(tempPath);

      if (fileStat.size > 0) {
        return fileStat;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < RECORDING_DOWNLOAD_ATTEMPTS) {
      await delay(RECORDING_DOWNLOAD_RETRY_MS);
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Recording was downloaded as an empty file.");
}

async function createRecordingPreview(options: {
  sandboxId: string;
  recordingId: string;
}): Promise<{
  recording: DaytonaRecording;
  filename: string;
  contentType: string;
  sizeBytes: number;
  stream: (range?: ByteRange) => ReadableStream<Uint8Array>;
  cleanup: () => Promise<void>;
}> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const recording = await sandbox.computerUse.recording.get(options.recordingId) as DaytonaRecording;
  const filename = safeRecordingFilename(options.recordingId, recording.fileName);
  const tempDir = await mkdtemp(join(tmpdir(), "autopr-recording-"));
  const tempPath = join(tempDir, filename);

  const fileStat = await downloadRecordingWithRetry(
    sandbox.computerUse.recording,
    options.recordingId,
    tempPath,
  );
  const contentType = await sniffRecordingContentType(tempPath, filename);

  return {
    recording,
    filename,
    contentType,
    sizeBytes: fileStat.size,
    stream: (range) => {
      const nodeStream = createReadStream(tempPath, range);
      const cleanup = () => {
        void rm(tempDir, { recursive: true, force: true });
      };

      nodeStream.on("close", cleanup);
      nodeStream.on("error", cleanup);

      return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    },
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

function contentDisposition(filename: string) {
  const fallback = filename.replace(/["\\\r\n]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function parseRangeHeader(rangeHeader: string | null, sizeBytes: number): ByteRange | "invalid" | null {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (!match) {
    return "invalid";
  }

  const [, rawStart, rawEnd] = match;

  if (!rawStart && !rawEnd) {
    return "invalid";
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }

    return {
      start: Math.max(sizeBytes - suffixLength, 0),
      end: sizeBytes - 1,
    };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : sizeBytes - 1;

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= sizeBytes
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, sizeBytes - 1),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load recording.";
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

  const recordingMetadata = messages
    .filter((message) => message.role === "assistant")
    .map((message) => findDemoRecordingMetadataInParts(message.parts, recordingId))
    .find(Boolean);

  if (!recordingMetadata) {
    return Response.json({ error: "Recording not found on this thread." }, { status: 404 });
  }

  try {
    const preview = await createRecordingPreview({
      sandboxId: project.sandboxId,
      recordingId,
    });

    const range = parseRangeHeader(req.headers.get("range"), preview.sizeBytes);

    if (range === "invalid") {
      await preview.cleanup();

      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${preview.sizeBytes}`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (range) {
      const contentLength = range.end - range.start + 1;

      return new Response(preview.stream(range), {
        status: 206,
        headers: {
          "Content-Type": preview.contentType,
          "Content-Disposition": contentDisposition(preview.filename),
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${range.start}-${range.end}/${preview.sizeBytes}`,
          "Content-Length": String(contentLength),
          "Cache-Control": "private, no-store",
        },
      });
    }

    return new Response(preview.stream(), {
      headers: {
        "Content-Type": preview.contentType,
        "Content-Disposition": contentDisposition(preview.filename),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Length": String(preview.sizeBytes),
      },
    });
  } catch (error) {
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

    const prepared = await prepareProjectSandboxCommit({ sandboxId: project.sandboxId });
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
