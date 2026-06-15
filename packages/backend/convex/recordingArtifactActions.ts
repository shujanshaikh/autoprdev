import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { IMAGE_URL_EXPIRES_IN_SECONDS, r2 } from "./imageUploads";

type EnsureUploadedResult = {
  status: "uploaded";
  url: string;
};

type R2StoreCtx = Parameters<typeof r2.store>[0];

const RECORDING_SOURCE_FETCH_TIMEOUT_MS = 60_000;

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isExistingR2ObjectError(error: unknown, key: string) {
  const message = errorMessage(error);
  return message.includes("Metadata already exists") && message.includes(key);
}

function numericHeader(headers: Headers, name: string) {
  const value = Number(headers.get(name));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function fetchRecordingSource(sourceUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, RECORDING_SOURCE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Could not fetch Daytona recording: ${response.status} ${response.statusText}`);
    }

    return {
      response,
      blob: await response.blob(),
    };
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
    sourceUrl: v.string(),
    sourceFileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
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
    const existing = await ctx.runQuery(internal.recordingArtifacts.getForUploadInternal, {
      authorId,
      projectId: args.projectId,
      threadId: args.threadId,
      recordingId: args.recordingId,
    });

    if (existing?.status === "uploaded" && existing.r2Key) {
      return {
        status: "uploaded",
        url: await r2.getUrl(existing.r2Key, { expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS }),
      };
    }

    const r2Key = existing?.r2Key ?? recordingObjectKey(authorId, args.threadId, args.recordingId);
    const fileName = safeFileName(args.recordingId, args.sourceFileName);
    const uploadState = await ctx.runMutation(internal.recordingArtifacts.markUploadingInternal, {
      authorId,
      projectId: args.projectId,
      threadId: args.threadId,
      recordingId: args.recordingId,
      r2Key,
      sourceFileName: fileName,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      durationSeconds: args.durationSeconds,
    });

    if (uploadState.status === "uploaded") {
      return {
        status: "uploaded",
        url: await r2.getUrl(uploadState.r2Key, { expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS }),
      };
    }

    try {
      const { response, blob } = await fetchRecordingSource(args.sourceUrl);
      const contentType = (args.contentType ?? response.headers.get("content-type") ?? blob.type) || "video/mp4";
      const sizeBytes = args.sizeBytes ?? numericHeader(response.headers, "content-length") ?? blob.size;

      try {
        await r2.store(ctx as unknown as R2StoreCtx, blob, {
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

      await ctx.runMutation(internal.recordingArtifacts.markUploadedInternal, {
        authorId,
        projectId: args.projectId,
        threadId: args.threadId,
        recordingId: args.recordingId,
        r2Key,
        sourceFileName: fileName,
        contentType,
        sizeBytes,
        durationSeconds: args.durationSeconds,
      });

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
        error: errorMessage(error),
      });

      throw error;
    }
  },
});
