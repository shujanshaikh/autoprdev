import { ConvexError } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type PersistenceGrantLookupCtx = Pick<QueryCtx | MutationCtx, "db">;

export async function hashAgentPersistenceToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireAgentPersistenceGrant(
  ctx: PersistenceGrantLookupCtx,
  args: {
    threadId: string;
    assistantMessageId: string;
    tokenHash: string;
  },
): Promise<{ thread: Doc<"threads">; assistant: Doc<"messages"> }> {
  const assistant = await ctx.db
    .query("messages")
    .withIndex("by_message_id", (q) => q.eq("messageId", args.assistantMessageId))
    .unique();

  if (
    !assistant ||
    assistant.threadId !== args.threadId ||
    assistant.role !== "assistant" ||
    assistant.agentPersistenceTokenHash !== args.tokenHash
  ) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  const thread = await ctx.db
    .query("threads")
    .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
    .unique();

  if (
    !thread ||
    thread.projectId !== assistant.projectId ||
    thread.authorId !== assistant.authorId
  ) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  return { thread, assistant };
}
