import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import {
  collectAssistantPartsBlobKeys,
  deleteAssistantPartsBlobKeys,
  type AssistantPartsBlobDeleteCtx,
} from "./lib/assistantPartsBlobs";
import {
  hashAgentPersistenceToken,
  requireAgentPersistenceGrant,
} from "./lib/agentPersistence";
import { requireUserId } from "./lib/auth";
import { requireDemoRecordingExperimentEnabled } from "./lib/userSettings";
import { randomUuid } from "./lib/uuid";

const shortError = (message: string) => message.slice(0, 700);
const longError = (message: string) => message.slice(0, 8_000);

export const create = mutation({
  args: {
    projectId: v.string(),
    title: v.optional(v.string()),
    demoEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    if (project.sandboxStatus !== "ready") {
      throw new ConvexError({ code: "PROJECT_NOT_READY" });
    }

    if (args.demoEnabled) {
      await requireDemoRecordingExperimentEnabled(ctx, authorId);
    }

    const now = Date.now();
    const threadId = randomUuid();

    await ctx.db.insert("threads", {
      threadId,
      projectId: args.projectId,
      authorId,
      title: args.title?.trim() || "New thread",
      createdAt: now,
      updatedAt: now,
      isLive: false,
      demoEnabled: args.demoEnabled ?? false,
    });

    return threadId;
  },
});

export const listByProject = query({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const project = await ctx.db
      .query("projects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!project || project.authorId !== identity.subject) {
      return [];
    }

    return await ctx.db
      .query("threads")
      .withIndex("by_author_project", (q) => q.eq("authorId", identity.subject).eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== identity.subject) {
      return null;
    }

    return thread;
  },
});

export const markRunStarted = mutation({
  args: {
    threadId: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const now = Date.now();

    const existingIssueRunId = thread.agentRunIssue?.runId ?? thread.workflowIssue?.workflowRunId;
    if (existingIssueRunId === args.runId) {
      await ctx.db.patch(thread._id, {
        currentRunId: undefined,
        isLive: false,
        updatedAt: now,
      });

      return null;
    }

    await ctx.db.patch(thread._id, {
      currentRunId: args.runId,
      isLive: true,
      agentRunIssue: undefined,
      workflowIssue: undefined,
      updatedAt: now,
    });

    return null;
  },
});

const runIssueValidator = v.object({
  runId: v.string(),
  stepName: v.optional(v.string()),
  attempt: v.optional(v.number()),
  retryCount: v.optional(v.number()),
  message: v.string(),
  errorStack: v.optional(v.string()),
  occurredAt: v.number(),
});

type RunIssue = {
  runId: string;
  stepName?: string;
  attempt?: number;
  retryCount?: number;
  message: string;
  errorStack?: string;
  occurredAt: number;
};

async function applyRunIssue(
  ctx: MutationCtx,
  thread: Doc<"threads">,
  issue: RunIssue,
) {
  if (thread.currentRunId && thread.currentRunId !== issue.runId) {
    return null;
  }

  if (thread.agentRunIssue?.runId === issue.runId) {
    return null;
  }

  await ctx.db.patch(thread._id, {
    currentRunId: undefined,
    isLive: false,
    agentRunIssue: {
      ...issue,
      message: shortError(issue.message),
      errorStack: issue.errorStack ? longError(issue.errorStack) : undefined,
    },
    workflowIssue: undefined,
    updatedAt: Date.now(),
  });

  return null;
}

export const recordAgentRunIssue = mutation({
  args: {
    threadId: v.string(),
    issue: runIssueValidator,
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    return await applyRunIssue(ctx, thread, args.issue);
  },
});

/** Compatibility endpoint for runs started before the Trigger.dev deployment. */
export const recordWorkflowIssue = mutation({
  args: {
    threadId: v.string(),
    issue: v.object({
      workflowRunId: v.string(),
      stepName: v.optional(v.string()),
      attempt: v.optional(v.number()),
      retryCount: v.optional(v.number()),
      message: v.string(),
      errorStack: v.optional(v.string()),
      occurredAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const { workflowRunId, ...issue } = args.issue;
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    return await applyRunIssue(ctx, thread, {
      ...issue,
      runId: workflowRunId,
    });
  },
});

export const recordAgentRunIssueFromAgentInternal = internalMutation({
  args: {
    threadId: v.string(),
    assistantMessageId: v.string(),
    tokenHash: v.string(),
    issue: runIssueValidator,
  },
  handler: async (ctx, args) => {
    const { thread, assistant } = await requireAgentPersistenceGrant(ctx, args);
    const result = await applyRunIssue(ctx, thread, args.issue);
    await ctx.db.patch(assistant._id, { agentPersistenceTokenHash: undefined });
    return result;
  },
});

export const recordAgentRunIssueFromAgent = action({
  args: {
    threadId: v.string(),
    assistantMessageId: v.string(),
    persistenceToken: v.string(),
    issue: runIssueValidator,
  },
  handler: async (ctx, args): Promise<null> => {
    return await ctx.runMutation(internal.threads.recordAgentRunIssueFromAgentInternal, {
      threadId: args.threadId,
      assistantMessageId: args.assistantMessageId,
      tokenHash: await hashAgentPersistenceToken(args.persistenceToken),
      issue: args.issue,
    });
  },
});

async function applyRunFinished(
  ctx: MutationCtx,
  thread: Doc<"threads">,
  runId?: string,
) {
  if (runId && thread.currentRunId && thread.currentRunId !== runId) {
    return null;
  }

  await ctx.db.patch(thread._id, {
    currentRunId: undefined,
    isLive: false,
    updatedAt: Date.now(),
  });

  return null;
}

export const markRunFinished = mutation({
  args: {
    threadId: v.string(),
    runId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    return await applyRunFinished(ctx, thread, args.runId);
  },
});

export const markRunFinishedFromAgentInternal = internalMutation({
  args: {
    threadId: v.string(),
    assistantMessageId: v.string(),
    tokenHash: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const { thread, assistant } = await requireAgentPersistenceGrant(ctx, args);
    const result = await applyRunFinished(ctx, thread, args.runId);
    await ctx.db.patch(assistant._id, { agentPersistenceTokenHash: undefined });
    return result;
  },
});

export const markRunFinishedFromAgent = action({
  args: {
    threadId: v.string(),
    assistantMessageId: v.string(),
    persistenceToken: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    return await ctx.runMutation(internal.threads.markRunFinishedFromAgentInternal, {
      threadId: args.threadId,
      assistantMessageId: args.assistantMessageId,
      tokenHash: await hashAgentPersistenceToken(args.persistenceToken),
      runId: args.runId,
    });
  },
});

async function requireThreadForAuthor(ctx: any, threadId: string) {
  const authorId = await requireUserId(ctx);
  const thread = await ctx.db
    .query("threads")
    .withIndex("by_thread_id", (q: any) => q.eq("threadId", threadId))
    .unique();

  if (!thread || thread.authorId !== authorId) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  return thread;
}

export const setDemoEnabled = mutation({
  args: {
    threadId: v.string(),
    demoEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);

    if (args.demoEnabled) {
      await requireDemoRecordingExperimentEnabled(ctx, thread.authorId);
    }

    await ctx.db.patch(thread._id, {
      demoEnabled: args.demoEnabled,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const markPullRequestCreating = mutation({
  args: {
    threadId: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);

    await ctx.db.patch(thread._id, {
      pullRequestStatus: "creating",
      pullRequestBranch: args.branch,
      pullRequestError: undefined,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const markPullRequestCreated = mutation({
  args: {
    threadId: v.string(),
    branch: v.string(),
    url: v.string(),
    number: v.number(),
  },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);

    await ctx.db.patch(thread._id, {
      pullRequestStatus: "created",
      pullRequestUrl: args.url,
      pullRequestNumber: args.number,
      pullRequestBranch: args.branch,
      pullRequestError: undefined,
      pullRequestCreatedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const markPullRequestFailed = mutation({
  args: {
    threadId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);

    await ctx.db.patch(thread._id, {
      pullRequestStatus: "failed",
      pullRequestError: shortError(args.error),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const markChangesCommitted = mutation({
  args: {
    threadId: v.string(),
    status: v.union(v.literal("committed"), v.literal("pushed")),
    branch: v.string(),
    commitSha: v.string(),
    commitMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);

    await ctx.db.patch(thread._id, {
      commitStatus: args.status,
      commitBranch: args.branch,
      commitSha: args.commitSha,
      commitMessage: args.commitMessage,
      committedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const remove = mutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    await deleteAssistantPartsBlobKeys(
      ctx as unknown as AssistantPartsBlobDeleteCtx,
      collectAssistantPartsBlobKeys(messages),
    );
    await Promise.all(messages.map((message) => ctx.db.delete(message._id)));
    await ctx.db.delete(thread._id);

    return { projectId: thread.projectId };
  },
});
