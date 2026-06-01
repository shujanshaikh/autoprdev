import { createFileRoute } from "@tanstack/react-router";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createSandbox } from "@autopr/agent/sandbox";
import { api } from "@autopr/backend/convex/_generated/api";

import { convexMutation, convexQuery } from "#/lib/convex-server";
import { findDemoRecordingMetadataInParts } from "#/lib/chat-messages";

type DaytonaRecording = {
  fileName?: string;
  sizeBytes?: number;
};

function safeRecordingFilename(recordingId: string, fileName?: string) {
  const candidate = fileName?.trim() || `${recordingId}.mp4`;
  return candidate.replace(/[^a-zA-Z0-9._-]/g, "_") || `${recordingId}.mp4`;
}

async function createRecordingPreview(options: {
  sandboxId: string;
  recordingId: string;
}): Promise<{
  recording: DaytonaRecording;
  filename: string;
  contentType: string;
  stream: ReadableStream<Uint8Array>;
}> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const recording = await sandbox.computerUse.recording.get(options.recordingId) as DaytonaRecording;
  const filename = safeRecordingFilename(options.recordingId, recording.fileName);
  const tempDir = await mkdtemp(join(tmpdir(), "autopr-recording-"));
  const tempPath = join(tempDir, filename);

  await sandbox.computerUse.recording.download(options.recordingId, tempPath);

  const nodeStream = createReadStream(tempPath);
  const cleanup = () => {
    void rm(tempDir, { recursive: true, force: true });
  };

  nodeStream.on("close", cleanup);
  nodeStream.on("error", cleanup);

  return {
    recording,
    filename,
    contentType: "video/mp4",
    stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
  };
}

function contentDisposition(filename: string) {
  const fallback = filename.replace(/["\\\r\n]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load recording.";
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
    return new Response(preview.stream, {
      headers: {
        "Content-Type": preview.contentType,
        "Content-Disposition": contentDisposition(preview.filename),
        "Cache-Control": "private, no-store",
        ...(preview.recording.sizeBytes ? { "Content-Length": String(preview.recording.sizeBytes) } : {}),
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

export const Route = createFileRoute("/api/project/$projectId/thread/$threadId")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: any }) =>
        GET(request, { params: Promise.resolve(params) } as any),
      DELETE: async ({ request, params }: { request: Request; params: any }) =>
        DELETE(request, { params: Promise.resolve(params) } as any),
    },
  },
});
