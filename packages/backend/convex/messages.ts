import { ConvexError, v } from "convex/values";
import type { UIMessage } from "ai";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { IMAGE_URL_EXPIRES_IN_SECONDS, r2 } from "./imageUploads";
import { deleteAssistantPartsBlobKeysBestEffort } from "./lib/assistantPartsBlobs";
import { requireUserId } from "./lib/auth";

const ASSISTANT_PARTS_CONTENT_TYPE = "application/json; charset=utf-8";
const ASSISTANT_PARTS_URL_EXPIRES_IN_SECONDS = 60;
// Keep ordinary text responses inline; only larger assistant payloads pay the R2 round trip.
const ASSISTANT_PARTS_INLINE_MAX_BYTES = 32 * 1024;

type R2StoreCtx = Parameters<typeof r2.store>[0];
type R2DeleteCtx = Parameters<typeof r2.deleteObject>[0];
type MessageDoc = Doc<"messages">;
type HydratedMessageDoc = MessageDoc & {
  parts: UIMessage["parts"];
};
type AssistantBlobRequest = {
  messageId: string;
  partsR2Key: string;
  partsBlobSizeBytes?: number;
  partsBlobSha256?: string;
};

const assistantBlobRequestValidator = v.object({
  messageId: v.string(),
  partsR2Key: v.string(),
  partsBlobSizeBytes: v.optional(v.number()),
  partsBlobSha256: v.optional(v.string()),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeObjectKeySegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "unknown";
}

function assistantPartsObjectKey(authorId: string, threadId: string, messageId: string, sha256: string) {
  return [
    "assistant-message-parts",
    safeObjectKeySegment(authorId),
    safeObjectKeySegment(threadId),
    safeObjectKeySegment(messageId),
    `${sha256}.json`,
  ].join("/");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isExistingR2ObjectError(error: unknown, key: string) {
  const message = errorMessage(error);
  return message.includes("Metadata already exists") && message.includes(key);
}

async function sha256Hex(bytes: Uint8Array) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeAssistantParts(parts: UIMessage["parts"]) {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  return {
    bytes,
    sizeBytes: bytes.byteLength,
  };
}

function parseAssistantParts(value: string): UIMessage["parts"] {
  const parsed = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    throw new Error("Assistant parts blob did not contain an array.");
  }

  return parsed as UIMessage["parts"];
}

function assistantPartsUnavailable(): UIMessage["parts"] {
  return [{
    type: "text",
    text: "Assistant response content is unavailable because its stored parts could not be loaded.",
  }] as UIMessage["parts"];
}

function fallbackAssistantParts(message: MessageDoc): UIMessage["parts"] {
  return message.parts.length > 0
    ? message.parts as UIMessage["parts"]
    : assistantPartsUnavailable();
}

function shouldStoreAssistantPartsInline(sizeBytes: number) {
  return sizeBytes <= ASSISTANT_PARTS_INLINE_MAX_BYTES;
}

async function requireOwnedThread(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  authorId: string,
) {
  const thread = await ctx.db
    .query("threads")
    .withIndex("by_thread_id", (q) => q.eq("threadId", threadId))
    .unique();

  if (!thread || thread.authorId !== authorId) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  const project = await ctx.db
    .query("projects")
    .withIndex("by_project_id", (q) => q.eq("projectId", thread.projectId))
    .unique();

  if (!project || project.authorId !== authorId) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  return { thread, project };
}

function getR2Key(part: UIMessage["parts"][number]) {
  if (part.type !== "file" || !isRecord(part.providerMetadata)) {
    return null;
  }

  const autoprMetadata = part.providerMetadata.autopr;

  return isRecord(autoprMetadata) && typeof autoprMetadata.r2Key === "string"
    ? autoprMetadata.r2Key
    : null;
}

async function getOwnedR2Url(ctx: QueryCtx, authorId: string, key: string) {
  const upload = await ctx.db
    .query("uploadedImages")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (!upload || upload.authorId !== authorId) {
    return null;
  }

  return await r2.getUrl(key, {
    expiresIn: IMAGE_URL_EXPIRES_IN_SECONDS,
  });
}

export const getOwnedR2UrlInternal = internalQuery({
  args: {
    authorId: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    return await getOwnedR2Url(ctx, args.authorId, args.key);
  },
});

async function refreshR2FilePartUrls(
  ctx: QueryCtx,
  authorId: string,
  parts: UIMessage["parts"],
): Promise<UIMessage["parts"]> {
  return await Promise.all(parts.map(async (part) => {
    const key = getR2Key(part);

    if (!key || part.type !== "file") {
      return part;
    }

    const url = await getOwnedR2Url(ctx, authorId, key);

    return url ? { ...part, url } : part;
  }));
}

async function refreshR2FilePartUrlsFromAction(
  ctx: Pick<ActionCtx, "runQuery">,
  authorId: string,
  parts: UIMessage["parts"],
): Promise<UIMessage["parts"]> {
  return await Promise.all(parts.map(async (part) => {
    const key = getR2Key(part);

    if (!key || part.type !== "file") {
      return part;
    }

    const url = await ctx.runQuery(internal.messages.getOwnedR2UrlInternal, { authorId, key });

    return url ? { ...part, url } : part;
  }));
}

export const listByThread = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== identity.subject) {
      return [];
    }

    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", thread.projectId))
      .unique();

    if (!project || project.authorId !== identity.subject) {
      return [];
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();

    return await Promise.all(messages.map(async (message) => ({
      ...message,
      parts: await refreshR2FilePartUrls(ctx, identity.subject, message.parts),
    })));
  },
});

export const listByThreadForHydrationInternal = internalQuery({
  args: {
    authorId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== args.authorId) {
      return [];
    }

    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", thread.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      return [];
    }

    return await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();
  },
});

export const listAssistantBlobMessagesForHydrationInternal = internalQuery({
  args: {
    authorId: v.string(),
    threadId: v.string(),
    blobs: v.array(assistantBlobRequestValidator),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== args.authorId) {
      return null;
    }

    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", thread.projectId))
      .unique();

    if (!project || project.authorId !== args.authorId) {
      return null;
    }

    const requestedByMessageId = new Map(args.blobs.map((blob: AssistantBlobRequest) => [blob.messageId, blob]));
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    return messages.filter((message) => {
      const requested = requestedByMessageId.get(message.messageId);

      return (
        requested !== undefined &&
        message.role === "assistant" &&
        message.authorId === args.authorId &&
        message.partsR2Key === requested.partsR2Key &&
        message.partsBlobSizeBytes === requested.partsBlobSizeBytes &&
        message.partsBlobSha256 === requested.partsBlobSha256
      );
    });
  },
});

async function readAssistantPartsBlob(args: {
  key: string;
  expectedSizeBytes?: number;
  expectedSha256?: string;
}): Promise<UIMessage["parts"]> {
  const url = await r2.getUrl(args.key, {
    expiresIn: ASSISTANT_PARTS_URL_EXPIRES_IN_SECONDS,
  });
  const response = await fetch(url);

  if (!response.ok) {
    throw new ConvexError({
      code: "ASSISTANT_PARTS_BLOB_NOT_FOUND",
      key: args.key,
      status: response.status,
    });
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (args.expectedSizeBytes !== undefined && bytes.byteLength !== args.expectedSizeBytes) {
    throw new ConvexError({
      code: "ASSISTANT_PARTS_BLOB_SIZE_MISMATCH",
      key: args.key,
    });
  }

  if (args.expectedSha256) {
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== args.expectedSha256) {
      throw new ConvexError({
        code: "ASSISTANT_PARTS_BLOB_HASH_MISMATCH",
        key: args.key,
      });
    }
  }

  return parseAssistantParts(new TextDecoder().decode(bytes));
}

async function readAssistantPartsForMessage(message: MessageDoc): Promise<UIMessage["parts"]> {
  if (message.role !== "assistant" || !message.partsR2Key) {
    return message.parts as UIMessage["parts"];
  }

  try {
    return await readAssistantPartsBlob({
      key: message.partsR2Key,
      expectedSizeBytes: message.partsBlobSizeBytes,
      expectedSha256: message.partsBlobSha256,
    });
  } catch (error) {
    console.warn("Failed to hydrate assistant message parts", {
      messageId: message.messageId,
      error: errorMessage(error),
    });
    return fallbackAssistantParts(message);
  }
}

async function hydrateMessageDoc(
  ctx: Pick<ActionCtx, "runQuery">,
  authorId: string,
  message: MessageDoc,
): Promise<HydratedMessageDoc> {
  const parts = await readAssistantPartsForMessage(message);

  return {
    ...message,
    parts: await refreshR2FilePartUrlsFromAction(ctx, authorId, parts),
  };
}

export const listByThreadHydrated = action({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<HydratedMessageDoc[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const messages: MessageDoc[] = await ctx.runQuery(internal.messages.listByThreadForHydrationInternal, {
      authorId: identity.subject,
      threadId: args.threadId,
    });

    return await Promise.all(messages.map((message) => hydrateMessageDoc(ctx, identity.subject, message)));
  },
});

export const hydrateAssistantParts = action({
  args: {
    threadId: v.string(),
    blobs: v.array(assistantBlobRequestValidator),
  },
  handler: async (ctx, args): Promise<Array<AssistantBlobRequest & { parts: UIMessage["parts"] }>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || args.blobs.length === 0) {
      return [];
    }

    const messages: MessageDoc[] | null = await ctx.runQuery(
      internal.messages.listAssistantBlobMessagesForHydrationInternal,
      {
        authorId: identity.subject,
        threadId: args.threadId,
        blobs: args.blobs,
      },
    );

    if (!messages) {
      return [];
    }

    const messagesById = new Map(messages.map((message) => [message.messageId, message]));

    return await Promise.all(args.blobs.map(async (blob) => {
      const message = messagesById.get(blob.messageId);

      if (!message) {
        return {
          ...blob,
          parts: assistantPartsUnavailable(),
        };
      }

      const parts = await readAssistantPartsForMessage(message);

      return {
        messageId: message.messageId,
        partsR2Key: message.partsR2Key ?? blob.partsR2Key,
        partsBlobSizeBytes: message.partsBlobSizeBytes,
        partsBlobSha256: message.partsBlobSha256,
        parts: await refreshR2FilePartUrlsFromAction(ctx, identity.subject, parts),
      };
    }));
  },
});

export const createTurn = mutation({
  args: {
    projectId: v.string(),
    threadId: v.string(),
    userMessage: v.object({
      messageId: v.string(),
      parts: v.array(v.any()),
      metadata: v.optional(v.any()),
    }),
    assistantMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const { thread } = await requireOwnedThread(ctx, args.threadId, authorId);

    if (thread.projectId !== args.projectId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const threadMessages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();

    const existingUser = threadMessages.find(
      (message) => message.role === "user" && message.messageId === args.userMessage.messageId,
    );

    if (existingUser) {
      const existingAssistant = threadMessages.find(
        (message) => message.role === "assistant" && message.createdAt >= existingUser.createdAt,
      );

      if (existingAssistant) {
        return existingAssistant.messageId;
      }
    }

    const existingAssistant = threadMessages.find(
      (message) => message.role === "assistant" && message.messageId === args.assistantMessageId,
    );

    if (existingAssistant) {
      return existingAssistant.messageId;
    }

    const now = Date.now();
    await ctx.db.insert("messages", {
      threadId: args.threadId,
      projectId: args.projectId,
      authorId,
      messageId: args.userMessage.messageId,
      role: "user",
      parts: args.userMessage.parts,
      metadata: args.userMessage.metadata,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("messages", {
      threadId: args.threadId,
      projectId: args.projectId,
      authorId,
      messageId: args.assistantMessageId,
      role: "assistant",
      parts: [],
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(thread._id, {
      updatedAt: now,
    });

    return args.assistantMessageId;
  },
});

export const getAssistantPatchTargetInternal = internalQuery({
  args: {
    authorId: v.string(),
    threadId: v.string(),
    assistantMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnedThread(ctx, args.threadId, args.authorId);
    const assistant = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("messageId", args.assistantMessageId))
      .first();

    if (
      !assistant ||
      assistant.authorId !== args.authorId ||
      assistant.threadId !== args.threadId ||
      assistant.role !== "assistant"
    ) {
      throw new ConvexError({ code: "NOT_FOUND" });
    }

    return {
      projectId: assistant.projectId,
    };
  },
});

export const patchAssistantInternal = internalMutation({
  args: {
    authorId: v.string(),
    threadId: v.string(),
    assistantMessageId: v.string(),
    parts: v.array(v.any()),
    partsR2Key: v.optional(v.string()),
    partsBlobContentType: v.optional(v.string()),
    partsBlobSizeBytes: v.optional(v.number()),
    partsBlobSha256: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { thread } = await requireOwnedThread(ctx, args.threadId, args.authorId);
    const assistant = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("messageId", args.assistantMessageId))
      .first();

    if (
      !assistant ||
      assistant.authorId !== args.authorId ||
      assistant.threadId !== args.threadId ||
      assistant.role !== "assistant"
    ) {
      throw new ConvexError({ code: "NOT_FOUND" });
    }

    const previousPartsR2Key = assistant.partsR2Key;
    const now = Date.now();
    await ctx.db.patch(assistant._id, {
      parts: args.parts,
      partsR2Key: args.partsR2Key,
      partsBlobContentType: args.partsBlobContentType,
      partsBlobSizeBytes: args.partsBlobSizeBytes,
      partsBlobSha256: args.partsBlobSha256,
      metadata: args.metadata,
      updatedAt: now,
    });

    await ctx.db.patch(thread._id, {
      updatedAt: now,
    });

    return { previousPartsR2Key };
  },
});

export const patchAssistant = action({
  args: {
    threadId: v.string(),
    assistantMessageId: v.string(),
    parts: v.array(v.any()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    await ctx.runQuery(internal.messages.getAssistantPatchTargetInternal, {
      authorId: identity.subject,
      threadId: args.threadId,
      assistantMessageId: args.assistantMessageId,
    });

    const parts = args.parts as UIMessage["parts"];
    const encoded = encodeAssistantParts(parts);
    const sha256 = await sha256Hex(encoded.bytes);
    const shouldStoreInline = shouldStoreAssistantPartsInline(encoded.sizeBytes);
    const partsR2Key = shouldStoreInline
      ? undefined
      : assistantPartsObjectKey(
          identity.subject,
          args.threadId,
          args.assistantMessageId,
          sha256,
        );
    let storedNewBlobKey: string | undefined;

    if (partsR2Key) {
      try {
        await r2.store(ctx as unknown as R2StoreCtx, encoded.bytes, {
          key: partsR2Key,
          type: ASSISTANT_PARTS_CONTENT_TYPE,
          disposition: `attachment; filename="${safeObjectKeySegment(args.assistantMessageId)}.json"`,
          cacheControl: "private, max-age=31536000, immutable",
        });
        storedNewBlobKey = partsR2Key;
      } catch (error) {
        if (!isExistingR2ObjectError(error, partsR2Key)) {
          throw error;
        }
      }
    }

    try {
      const result: { previousPartsR2Key?: string } = await ctx.runMutation(
        internal.messages.patchAssistantInternal,
        {
          authorId: identity.subject,
          threadId: args.threadId,
          assistantMessageId: args.assistantMessageId,
          parts: shouldStoreInline ? parts : [],
          partsR2Key,
          partsBlobContentType: partsR2Key ? ASSISTANT_PARTS_CONTENT_TYPE : undefined,
          partsBlobSizeBytes: partsR2Key ? encoded.sizeBytes : undefined,
          partsBlobSha256: partsR2Key ? sha256 : undefined,
          metadata: args.metadata,
        },
      );

      if (result.previousPartsR2Key && result.previousPartsR2Key !== partsR2Key) {
        await deleteAssistantPartsBlobKeysBestEffort(ctx as unknown as R2DeleteCtx, [result.previousPartsR2Key]);
      }
    } catch (error) {
      if (storedNewBlobKey) {
        await deleteAssistantPartsBlobKeysBestEffort(ctx as unknown as R2DeleteCtx, [storedNewBlobKey]);
      }
      throw error;
    }

    return null;
  },
});
