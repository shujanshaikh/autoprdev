import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import {
  collectAssistantPartsBlobKeys,
  deleteAssistantPartsBlobKeys,
  type AssistantPartsBlobDeleteCtx,
} from "./lib/assistantPartsBlobs";
import {
  hashAgentPersistenceToken,
  requireAgentPersistenceGrant,
  requireAgentSessionPersistenceGrant,
} from "./lib/agentPersistence";
import { requireUserId } from "./lib/auth";
import { requireDemoRecordingExperimentEnabled } from "./lib/userSettings";
import { randomUuid } from "./lib/uuid";
import { threadGitStatusValidator } from "./lib/gitStatus";
import {
  createThreadFeatureBranch,
  createThreadWorktreePath,
  resolveThreadBaseBranch,
} from "./lib/threadWorktree";

const shortError = (message: string) => message.slice(0, 700);
const longError = (message: string) => message.slice(0, 8_000);
const MAX_AGENT_SESSION_PERSISTENCE_GRANTS = 16;

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
    const title = args.title?.trim() || "New thread";
    const baseBranch = resolveThreadBaseBranch({}, project);
    const featureBranch = createThreadFeatureBranch(title, threadId);
    const worktreePath = project.sandboxWorkDir
      ? createThreadWorktreePath(project.sandboxWorkDir, project.repoName, threadId)
      : undefined;

    await ctx.db.insert("threads", {
      threadId,
      projectId: args.projectId,
      authorId,
      title,
      createdAt: now,
      updatedAt: now,
      isLive: false,
      demoEnabled: args.demoEnabled ?? false,
      baseBranch,
      featureBranch,
      worktreePath,
      worktreeStatus: "pending",
      worktreeUpdatedAt: now,
      gitStatusInvalidatedAt: now,
      gitStatusInvalidationReason: "worktree_created",
    });

    return threadId;
  },
});

export const getWorktreeContextInternal = internalQuery({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const [project, thread] = await Promise.all([
      ctx.db.query("projects").withIndex("by_project_id", (q) => q.eq("projectId", args.projectId)).unique(),
      ctx.db.query("threads").withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId)).unique(),
    ]);

    if (
      !project ||
      !thread ||
      project.authorId !== args.authorId ||
      thread.authorId !== args.authorId ||
      thread.projectId !== args.projectId
    ) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    return { project, thread };
  },
});

export const reserveWorktreeInternal = internalMutation({
  args: {
    authorId: v.string(),
    threadId: v.string(),
    baseBranch: v.string(),
    featureBranch: v.string(),
    worktreePath: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.query("threads").withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId)).unique();
    if (!thread || thread.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }
    if (
      (thread.baseBranch && thread.baseBranch !== args.baseBranch) ||
      (thread.featureBranch && thread.featureBranch !== args.featureBranch) ||
      (thread.worktreePath && thread.worktreePath !== args.worktreePath)
    ) {
      throw new ConvexError({ code: "THREAD_WORKTREE_METADATA_CONFLICT" });
    }

    const now = Date.now();
    const shouldInvalidate = thread.worktreeStatus !== "ready";
    await ctx.db.patch(thread._id, {
      baseBranch: thread.baseBranch ?? args.baseBranch,
      featureBranch: thread.featureBranch ?? args.featureBranch,
      worktreePath: thread.worktreePath ?? args.worktreePath,
      worktreeStatus: "provisioning",
      worktreeError: undefined,
      worktreeUpdatedAt: now,
      ...(shouldInvalidate ? {
        gitStatusInvalidatedAt: now,
        gitStatusInvalidationReason: "worktree_created" as const,
      } : {}),
      updatedAt: now,
    });
    return null;
  },
});

export const markWorktreeReadyInternal = internalMutation({
  args: {
    authorId: v.string(),
    threadId: v.string(),
    worktreePath: v.string(),
    headSha: v.string(),
    upstreamBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.query("threads").withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId)).unique();
    if (!thread || thread.authorId !== args.authorId) throw new ConvexError({ code: "UNAUTHORIZED" });
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      worktreePath: args.worktreePath,
      headSha: args.headSha,
      upstreamBranch: args.upstreamBranch,
      worktreeStatus: "ready",
      worktreeError: undefined,
      worktreeUpdatedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const markWorktreeFailedInternal = internalMutation({
  args: { authorId: v.string(), threadId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.query("threads").withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId)).unique();
    if (!thread || thread.authorId !== args.authorId) throw new ConvexError({ code: "UNAUTHORIZED" });
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      worktreeStatus: "failed",
      worktreeError: shortError(args.error),
      worktreeUpdatedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const markWorktreeCleanedInternal = internalMutation({
  args: { authorId: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.query("threads").withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId)).unique();
    if (!thread || thread.authorId !== args.authorId) throw new ConvexError({ code: "UNAUTHORIZED" });
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      worktreeStatus: "cleaned",
      worktreeError: undefined,
      worktreeUpdatedAt: now,
      updatedAt: now,
    });
    return null;
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

export const addAgentSessionPersistenceGrant = mutation({
  args: {
    threadId: v.string(),
    tokenHash: v.string(),
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

    const tokenHashes = [
      ...(thread.agentSessionPersistenceTokenHashes ?? []).filter(
        (tokenHash) => tokenHash !== args.tokenHash,
      ),
      args.tokenHash,
    ].slice(-MAX_AGENT_SESSION_PERSISTENCE_GRANTS);

    await ctx.db.patch(thread._id, {
      agentSessionPersistenceTokenHashes: tokenHashes,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const markAgentSessionCreated = mutation({
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

    const now = Date.now();
    await ctx.db.patch(thread._id, {
      triggerSessionCreatedAt: thread.triggerSessionCreatedAt ?? now,
      updatedAt: now,
    });

    return null;
  },
});

export const markAgentSessionTurnStartedInternal = internalMutation({
  args: {
    threadId: v.string(),
    tokenHash: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const { thread } = await requireAgentSessionPersistenceGrant(ctx, args);
    const now = Date.now();

    await ctx.db.patch(thread._id, {
      currentRunId: args.runId,
      isLive: true,
      triggerSessionCreatedAt: thread.triggerSessionCreatedAt ?? now,
      agentRunIssue: undefined,
      workflowIssue: undefined,
      updatedAt: now,
    });

    return null;
  },
});

export const markAgentSessionTurnStartedFromAgent = action({
  args: {
    threadId: v.string(),
    persistenceToken: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    return await ctx.runMutation(internal.threads.markAgentSessionTurnStartedInternal, {
      threadId: args.threadId,
      tokenHash: await hashAgentPersistenceToken(args.persistenceToken),
      runId: args.runId,
    });
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
    gitStatusInvalidatedAt: Date.now(),
    gitStatusInvalidationReason: "agent_changes",
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
    gitStatusInvalidatedAt: Date.now(),
    gitStatusInvalidationReason: "agent_changes",
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

const gitStatusInvalidationReasonValidator = v.union(
  v.literal("agent_changes"),
  v.literal("worktree_created"),
  v.literal("commit"),
  v.literal("pull_rebase"),
  v.literal("push"),
  v.literal("pull_request"),
  v.literal("sandbox_reconnect"),
  v.literal("manual"),
);

const gitMutationActionValidator = v.union(
  v.literal("commit"),
  v.literal("commit_push"),
  v.literal("push"),
  v.literal("pull"),
  v.literal("create_pr"),
);

const GIT_MUTATION_LEASE_MS = 30 * 60 * 1_000;

export const beginGitMutation = mutation({
  args: {
    threadId: v.string(),
    mutationId: v.string(),
    action: gitMutationActionValidator,
  },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    const now = Date.now();
    const hasActiveMutation = Boolean(
      thread.gitMutationId &&
      thread.gitMutationStartedAt &&
      thread.gitMutationStartedAt > now - GIT_MUTATION_LEASE_MS,
    );

    if (hasActiveMutation) {
      return {
        acquired: false as const,
        activeAction: thread.gitMutationAction,
      };
    }

    await ctx.db.patch(thread._id, {
      gitMutationId: args.mutationId,
      gitMutationAction: args.action,
      gitMutationStartedAt: now,
      updatedAt: now,
    });

    return { acquired: true as const };
  },
});

export const endGitMutation = mutation({
  args: {
    threadId: v.string(),
    mutationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    if (thread.gitMutationId === args.mutationId) {
      await ctx.db.patch(thread._id, {
        gitMutationId: undefined,
        gitMutationAction: undefined,
        gitMutationStartedAt: undefined,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const updateGitStatus = mutation({
  args: {
    threadId: v.string(),
    status: threadGitStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    await ctx.db.patch(thread._id, {
      gitStatus: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const invalidateGitStatus = mutation({
  args: {
    threadId: v.string(),
    reason: gitStatusInvalidationReasonValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      gitStatusInvalidatedAt: now,
      gitStatusInvalidationReason: args.reason,
      updatedAt: now,
    });
    return null;
  },
});

export const invalidateProjectGitStatusesInternal = internalMutation({
  args: {
    authorId: v.string(),
    projectId: v.string(),
    reason: gitStatusInvalidationReasonValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_author_project", (q) => q.eq("authorId", args.authorId).eq("projectId", args.projectId))
      .collect();
    const now = Date.now();
    await Promise.all(threads.map((thread) => ctx.db.patch(thread._id, {
      gitStatusInvalidatedAt: now,
      gitStatusInvalidationReason: args.reason,
      updatedAt: now,
    })));
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
    const now = Date.now();

    await ctx.db.patch(thread._id, {
      pullRequestStatus: "created",
      pullRequestUrl: args.url,
      pullRequestNumber: args.number,
      pullRequestBranch: args.branch,
      pullRequestError: undefined,
      pullRequestCreatedAt: now,
      gitStatusInvalidatedAt: now,
      gitStatusInvalidationReason: "pull_request",
      updatedAt: now,
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
    const now = Date.now();

    await ctx.db.patch(thread._id, {
      commitStatus: args.status,
      commitBranch: args.branch,
      commitSha: args.commitSha,
      commitMessage: args.commitMessage,
      headSha: args.commitSha,
      upstreamBranch: args.status === "pushed" ? `origin/${args.branch}` : thread.upstreamBranch,
      committedAt: now,
      gitStatusInvalidatedAt: now,
      gitStatusInvalidationReason: args.status === "pushed" ? "push" : "commit",
      updatedAt: now,
    });

    return null;
  },
});

export const removeInternal = internalMutation({
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
