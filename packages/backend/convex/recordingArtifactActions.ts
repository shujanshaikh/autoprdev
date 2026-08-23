"use node";

import { hasNumberType, hasStringType } from "@autopr/config/runtime-type";
import { isJsonObject, type JsonObject } from "@autopr/config/runtime-value";

import { Daytona } from "@daytona/sdk";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { IMAGE_URL_EXPIRES_IN_SECONDS, r2 } from "./imageUploads";
import { asR2ActionContext } from "./lib/r2Context";

type EnsureUploadedResult = {
  status: "uploaded";
  url: string;
};


const RECORDING_SOURCE_FETCH_TIMEOUT_MS = 60_000;
const RECORDING_DASHBOARD_PORT = 33333;
const RECORDING_PREVIEW_EXPIRES_SECONDS = 5 * 60;
const RECORDING_READY_ATTEMPTS = 10;
const RECORDING_READY_RETRY_MS = 1_000;
const MAX_RECORDING_BYTES = 250 * 1024 * 1024;

type DaytonaRecording = {
  fileName?: string;
  status?: string;
  endTime?: string;
  durationSeconds?: number;
  sizeBytes?: number;
};

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "unknown";
}

function safeFileName(recordingId: string, fileName?: string) {
  const candidate = fileName?.trim() || `${recordingId}.mp4`;
  return candidate.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180) || `${recordingId}.mp4`;
}

function contentDisposition(fileName: string) {
  const fallback = fileName.replace(/["\\\r\n]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function recordingObjectKey(authorId: string, threadId: string, recordingId: string) {
  return [
    "recordings",
    safeSegment(authorId),
    safeSegment(threadId),
    `${safeSegment(recordingId)}.mp4`,
  ].join("/");
}

function errorMessage<ErrorValue>(error: ErrorValue) {
  return error instanceof Error ? error.message : String(error);
}

function isExistingR2ObjectError<ErrorValue>(error: ErrorValue, key: string) {
  const message = errorMessage(error);
  return message.includes("Metadata already exists") && message.includes(key);
}

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}

function normalizeRecording<ValueValue>(value: ValueValue): DaytonaRecording {
  if (!isRecord(value)) return {};

  return {
    fileName: hasStringType(value.fileName) ? value.fileName : undefined,
    status: hasStringType(value.status) ? value.status : undefined,
    endTime: hasStringType(value.endTime) ? value.endTime : undefined,
    durationSeconds: hasNumberType(value.durationSeconds) ? value.durationSeconds : undefined,
    sizeBytes: hasNumberType(value.sizeBytes) ? value.sizeBytes : undefined,
  };
}

function isPlayableRecording(recording: DaytonaRecording) {
  return Boolean(
    recording.fileName?.trim()
      && (!recording.status || recording.status === "completed")
      && (recording.endTime || hasNumberType(recording.durationSeconds) || hasNumberType(recording.sizeBytes)),
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPlayableRecording(sandbox: Awaited<ReturnType<Daytona["get"]>>, recordingId: string) {
  let latest: DaytonaRecording = {};
  let lastError: unknown;

  for (let attempt = 1; attempt <= RECORDING_READY_ATTEMPTS; attempt += 1) {
    try {
      latest = normalizeRecording(await sandbox.computerUse.recording.get(recordingId));
      if (isPlayableRecording(latest)) return latest;
    } catch (error) {
      lastError = error;
    }

    if (attempt < RECORDING_READY_ATTEMPTS) await delay(RECORDING_READY_RETRY_MS);
  }

  if (lastError && !latest.fileName) throw lastError;
  throw new Error(`Recording is not ready for playback yet.${latest.status ? ` Current status: ${latest.status}.` : ""}`);
}

function recordingDashboardVideoUrl(baseUrl: string, fileName: string) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/videos/${encodeURIComponent(fileName)}`;
  return url.toString();
}

async function readLimitedBlob(response: Response) {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_RECORDING_BYTES) {
    throw new Error("Recording exceeds the maximum upload size.");
  }
  if (!response.body) throw new Error("Daytona recording response did not include a body.");

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let sizeBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > MAX_RECORDING_BYTES) {
        await reader.cancel("Recording exceeds the maximum upload size.");
        throw new Error("Recording exceeds the maximum upload size.");
      }
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk.buffer);
    }
  } finally {
    reader.releaseLock();
  }

  return { blob: new Blob(chunks, { type: "video/mp4" }), sizeBytes };
}

async function fetchRecordingSource(sourceUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, RECORDING_SOURCE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Could not fetch Daytona recording: ${response.status} ${response.statusText}`);
    }

    return await readLimitedBlob(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timed out fetching Daytona recording.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const ensureUploaded = action({
  args: {
    projectId: v.string(),
    threadId: v.string(),
    recordingId: v.string(),
  },
  returns: v.object({
    status: v.literal("uploaded"),
    url: v.string(),
  }),
  handler: async (ctx, args): Promise<EnsureUploadedResult> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const authorId = identity.subject;
    const [existing, project] = await Promise.all([
      ctx.runQuery(internal.recordingArtifacts.getForUploadInternal, {
        authorId,
        projectId: args.projectId,
        threadId: args.threadId,
        recordingId: args.recordingId,
      }),
      ctx.runQuery(internal.projects.getDesktopSandboxInternal, {
        authorId,
        projectId: args.projectId,
      }),
    ]);

    if (existing?.status === "uploaded" && existing.r2Key) {
      return {
        status: "uploaded",
        url: await r2.getUrl(existing.r2Key, { expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS }),
      };
    }

    const daytona = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
      apiUrl: process.env.DAYTONA_API_URL,
    });
    const sandbox = await daytona.get(project.sandboxId);
    const recording = await getPlayableRecording(sandbox, args.recordingId);
    const sourceFileName = recording.fileName?.trim();
    if (!sourceFileName) throw new Error("Recording file name is not available yet.");
    if (hasNumberType(recording.sizeBytes) && recording.sizeBytes > MAX_RECORDING_BYTES) {
      throw new Error("Recording exceeds the maximum upload size.");
    }
    const preview = await sandbox.getSignedPreviewUrl(
      RECORDING_DASHBOARD_PORT,
      RECORDING_PREVIEW_EXPIRES_SECONDS,
    );
    const sourceUrl = recordingDashboardVideoUrl(preview.url, sourceFileName);
    const r2Key = existing?.r2Key ?? recordingObjectKey(authorId, args.threadId, args.recordingId);
    const fileName = safeFileName(args.recordingId, sourceFileName);
    const contentType = "video/mp4";
    const uploadAttemptId = crypto.randomUUID();
    const uploadState = await ctx.runMutation(internal.recordingArtifacts.markUploadingInternal, {
      authorId,
      projectId: args.projectId,
      threadId: args.threadId,
      recordingId: args.recordingId,
      r2Key,
      sourceFileName: fileName,
      contentType,
      sizeBytes: recording.sizeBytes,
      durationSeconds: recording.durationSeconds,
      uploadAttemptId,
    });

    if (uploadState.status === "uploaded") {
      return {
        status: "uploaded",
        url: await r2.getUrl(uploadState.r2Key, { expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS }),
      };
    }

    try {
      const { blob, sizeBytes } = await fetchRecordingSource(sourceUrl);

      try {
        await r2.store(asR2ActionContext(ctx), blob, {
          key: r2Key,
          type: contentType,
          disposition: contentDisposition(fileName),
          cacheControl: "private, max-age=3600",
        });
      } catch (error) {
        if (!isExistingR2ObjectError(error, r2Key)) {
          throw error;
        }
      }

      const completion = await ctx.runMutation(internal.recordingArtifacts.markUploadedInternal, {
        authorId,
        projectId: args.projectId,
        threadId: args.threadId,
        recordingId: args.recordingId,
        r2Key,
        sourceFileName: fileName,
        contentType,
        sizeBytes,
        durationSeconds: recording.durationSeconds,
        uploadAttemptId,
      });

      if (!completion.applied) {
        const latest = await ctx.runQuery(internal.recordingArtifacts.getForUploadInternal, {
          authorId,
          projectId: args.projectId,
          threadId: args.threadId,
          recordingId: args.recordingId,
        });
        if (latest?.status === "uploaded" && latest.r2Key) {
          return {
            status: "uploaded",
            url: await r2.getUrl(latest.r2Key, { expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS }),
          };
        }

        throw new ConvexError({
          code: "RECORDING_UPLOAD_CONFLICT",
          message: "A newer recording upload attempt replaced this one. Try again.",
        });
      }

      return {
        status: "uploaded",
        url: await r2.getUrl(r2Key, { expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS }),
      };
    } catch (error) {
      await ctx.runMutation(internal.recordingArtifacts.markFailedInternal, {
        authorId,
        projectId: args.projectId,
        threadId: args.threadId,
        recordingId: args.recordingId,
        uploadAttemptId,
        error: errorMessage(error),
      });

      throw error;
    }
  },
});
