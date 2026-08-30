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
  gitWorkflowActionValidator,
  gitWorkflowFailureValidator,
  gitWorkflowPhaseResultValidator,
  gitWorkflowPhaseValidator,
  gitWorkflowPushResultValidator,
  nextGitWorkflowPhase,
} from "./lib/gitWorkflow";
import {
  createThreadFeatureBranch,
  createThreadWorktreePath,
  resolveThreadBaseBranch,
  resolveThreadWorkspaceMode,
} from "./lib/threadWorktree";
import {
  githubPullRequestLocalBranch,
  isThreadCompatibleWithGithubPullRequest,
} from "./lib/githubPullRequest";

const shortError = (message: string) => message.slice(0, 700);
const longError = (message: string) => message.slice(0, 8_000);
const MAX_AGENT_SESSION_PERSISTENCE_GRANTS = 16;

export const create = mutation({
  args: {
    projectId: v.string(),
    title: v.optional(v.string()),
    demoEnabled: v.optional(v.boolean()),
    workspaceMode: v.optional(v.union(v.literal("checkout"), v.literal("worktree"))),
    agentProvider: v.optional(v.union(v.literal("openai-codex"), v.literal("xai"))),
    agentModel: v.optional(v.string()),
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
    const agentModel = args.agentModel?.trim();
    if (
      (args.agentProvider && !agentModel) ||
      (!args.agentProvider && agentModel) ||
      (agentModel?.length ?? 0) > 200
    ) {
      throw new ConvexError({ code: "INVALID_AGENT_MODEL_SELECTION" });
    }
    const workspaceMode = args.workspaceMode ?? "checkout";
    const baseBranch = resolveThreadBaseBranch({}, project);
    const featureBranch = workspaceMode === "worktree"
      ? createThreadFeatureBranch(title, threadId)
      : undefined;
    const worktreePath = workspaceMode === "worktree" && project.sandboxWorkDir
      ? createThreadWorktreePath(project.sandboxWorkDir, project.repoName, threadId)
      : undefined;

    await ctx.db.insert("threads", {
      threadId,
      projectId: args.projectId,
      authorId,
      title,
      agentProvider: args.agentProvider,
      agentModel,
      createdAt: now,
      updatedAt: now,
      isLive: false,
      demoEnabled: args.demoEnabled ?? false,
      workspaceMode,
      baseBranch,
      featureBranch,
      worktreePath,
      ...(workspaceMode === "worktree" ? {
        worktreeStatus: "pending" as const,
        worktreeUpdatedAt: now,
      } : {}),
      gitStatusInvalidatedAt: now,
      gitStatusInvalidationReason: workspaceMode === "worktree" ? "worktree_created" : "manual",
    });

    return threadId;
  },
});

const githubPullRequestInputValidator = v.object({
  number: v.number(),
  title: v.string(),
  author: v.string(),
  state: v.union(v.literal("open"), v.literal("closed"), v.literal("merged")),
  draft: v.boolean(),
  htmlUrl: v.string(),
  head: v.object({
    repositoryId: v.number(),
    repositoryFullName: v.string(),
    cloneUrl: v.string(),
    branch: v.string(),
    sha: v.string(),
    branchAvailable: v.boolean(),
    canPush: v.boolean(),
  }),
  base: v.object({
    repositoryId: v.number(),
    repositoryFullName: v.string(),
    cloneUrl: v.string(),
    branch: v.string(),
    sha: v.string(),
  }),
  isFork: v.boolean(),
});

type GithubPullRequestInput = {
  number: number;
  title: string;
  author: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  htmlUrl: string;
  head: {
    repositoryId: number;
    repositoryFullName: string;
    cloneUrl: string;
    branch: string;
    sha: string;
    branchAvailable: boolean;
    canPush: boolean;
  };
  base: {
    repositoryId: number;
    repositoryFullName: string;
    cloneUrl: string;
    branch: string;
    sha: string;
  };
  isFork: boolean;
};

function githubPullRequestPatch(pullRequest: GithubPullRequestInput) {
  return {
    pullRequestStatus: "created" as const,
    pullRequestUrl: pullRequest.htmlUrl,
    pullRequestNumber: pullRequest.number,
    pullRequestBranch: pullRequest.head.branch,
    githubPullRequestTitle: pullRequest.title,
    githubPullRequestAuthor: pullRequest.author,
    githubPullRequestState: pullRequest.state,
    githubPullRequestDraft: pullRequest.draft,
    githubPullRequestHeadRepositoryId: pullRequest.head.repositoryId,
    githubPullRequestHeadRepository: pullRequest.head.repositoryFullName,
    githubPullRequestHeadCloneUrl: pullRequest.head.cloneUrl,
    githubPullRequestHeadBranch: pullRequest.head.branch,
    githubPullRequestHeadSha: pullRequest.head.sha,
    githubPullRequestHeadCanPush: pullRequest.head.canPush,
    githubPullRequestBaseRepositoryId: pullRequest.base.repositoryId,
    githubPullRequestBaseRepository: pullRequest.base.repositoryFullName,
    githubPullRequestBaseCloneUrl: pullRequest.base.cloneUrl,
    githubPullRequestBaseBranch: pullRequest.base.branch,
    githubPullRequestIsFork: pullRequest.isFork,
  };
}

export const createFromGithubPullRequest = mutation({
  args: { projectId: v.string(), pullRequest: githubPullRequestInputValidator },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const project = await ctx.db.query("projects").withIndex("by_project_id", (q) => q.eq("projectId", args.projectId)).unique();
    if (!project || project.authorId !== authorId) throw new ConvexError({ code: "UNAUTHORIZED" });
    if (project.sandboxStatus !== "ready") throw new ConvexError({ code: "PROJECT_NOT_READY" });

    const existing = (await ctx.db.query("threads")
      .withIndex("by_author_project", (q) => q.eq("authorId", authorId).eq("projectId", args.projectId))
      .collect())
      .find((thread) => thread.pullRequestNumber === args.pullRequest.number);
    if (existing) return { threadId: existing.threadId, reused: true };

    const now = Date.now();
    const threadId = randomUuid();
    await ctx.db.insert("threads", {
      threadId,
      projectId: args.projectId,
      authorId,
      title: args.pullRequest.title,
      createdAt: now,
      updatedAt: now,
      isLive: false,
      demoEnabled: false,
      workspaceMode: "worktree",
      baseBranch: args.pullRequest.base.branch,
      featureBranch: githubPullRequestLocalBranch(args.pullRequest.number, args.pullRequest.head.sha),
      worktreePath: project.sandboxWorkDir
        ? createThreadWorktreePath(project.sandboxWorkDir, project.repoName, threadId)
        : undefined,
      worktreeStatus: "pending",
      worktreeUpdatedAt: now,
      gitStatusInvalidatedAt: now,
      gitStatusInvalidationReason: "worktree_created",
      ...githubPullRequestPatch(args.pullRequest),
    });
    return { threadId, reused: false };
  },
});

export const attachGithubPullRequest = mutation({
  args: { projectId: v.string(), threadId: v.string(), pullRequest: githubPullRequestInputValidator },
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const [project, thread] = await Promise.all([
      ctx.db.query("projects").withIndex("by_project_id", (q) => q.eq("projectId", args.projectId)).unique(),
      ctx.db.query("threads").withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId)).unique(),
    ]);
    if (!project || !thread || project.authorId !== authorId || thread.authorId !== authorId || thread.projectId !== args.projectId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }
    if (thread.pullRequestNumber === args.pullRequest.number) {
      return { threadId: thread.threadId, reused: true };
    }
    if (thread.pullRequestNumber) {
      throw new ConvexError({ code: "THREAD_ALREADY_HAS_PULL_REQUEST" });
    }
    const existingMessage = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    if (!isThreadCompatibleWithGithubPullRequest({
      ...thread,
      hasMessages: Boolean(existingMessage),
    })) {
      throw new ConvexError({
        code: "THREAD_NOT_COMPATIBLE",
        message: "Choose a thread that has not started and does not have a materialized worktree.",
      });
    }

    const now = Date.now();
    await ctx.db.patch(thread._id, {
      title: thread.title === "New thread" ? args.pullRequest.title : thread.title,
      workspaceMode: "worktree",
      baseBranch: args.pullRequest.base.branch,
      featureBranch: githubPullRequestLocalBranch(args.pullRequest.number, args.pullRequest.head.sha),
      worktreePath: project.sandboxWorkDir
        ? createThreadWorktreePath(project.sandboxWorkDir, project.repoName, thread.threadId)
        : undefined,
      worktreeStatus: "pending",
      worktreeError: undefined,
      worktreeUpdatedAt: now,
      gitStatusInvalidatedAt: now,
      gitStatusInvalidationReason: "worktree_created",
      updatedAt: now,
      ...githubPullRequestPatch(args.pullRequest),
    });
    return { threadId: thread.threadId, reused: false };
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
    attemptId: v.string(),
  },
  returns: v.object({ acquired: v.boolean() }),
  handler: async (ctx, args) => {
    const thread = await ctx.db.query("threads").withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId)).unique();
    if (!thread || thread.authorId !== args.authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }
    if (resolveThreadWorkspaceMode(thread) !== "worktree") {
      throw new ConvexError({ code: "THREAD_WORKTREE_NOT_ENABLED" });
    }
    if (
      (thread.baseBranch && thread.baseBranch !== args.baseBranch) ||
      (thread.featureBranch && thread.featureBranch !== args.featureBranch) ||
      (thread.worktreePath && thread.worktreePath !== args.worktreePath)
    ) {
      throw new ConvexError({ code: "THREAD_WORKTREE_METADATA_CONFLICT" });
    }

    const now = Date.now();
    if (
      thread.worktreeStatus === "provisioning"
      && thread.worktreeUpdatedAt
      && now - thread.worktreeUpdatedAt < 120_000
    ) {
      return { acquired: false };
    }
    const shouldInvalidate = thread.worktreeStatus !== "ready";
    await ctx.db.patch(thread._id, {
      workspaceMode: "worktree",
      baseBranch: thread.baseBranch ?? args.baseBranch,
      featureBranch: thread.featureBranch ?? args.featureBranch,
      worktreePath: thread.worktreePath ?? args.worktreePath,
      worktreeStatus: "provisioning",
      worktreeProvisionAttemptId: args.attemptId,
      worktreeError: undefined,
      worktreeUpdatedAt: now,
      ...(shouldInvalidate ? {
        gitStatusInvalidatedAt: now,
        gitStatusInvalidationReason: "worktree_created" as const,
      } : {}),
      updatedAt: now,
    });
    return { acquired: true };
  },
});

export const markWorktreeReadyInternal = internalMutation({
  args: {
    authorId: v.string(),
    threadId: v.string(),
    attemptId: v.string(),
    worktreePath: v.string(),
    headSha: v.string(),
    upstreamBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.query("threads").withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId)).unique();
    if (!thread || thread.authorId !== args.authorId) throw new ConvexError({ code: "UNAUTHORIZED" });
    if (
      thread.worktreeStatus !== "provisioning"
      || thread.worktreeProvisionAttemptId !== args.attemptId
    ) {
      return false;
    }
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      worktreePath: args.worktreePath,
      headSha: args.headSha,
      upstreamBranch: args.upstreamBranch,
      worktreeStatus: "ready",
      worktreeProvisionAttemptId: undefined,
      worktreeError: undefined,
      worktreeUpdatedAt: now,
      updatedAt: now,
    });
    return true;
  },
});

export const markWorktreeFailedInternal = internalMutation({
  args: {
    authorId: v.string(),
    threadId: v.string(),
    attemptId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.query("threads").withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId)).unique();
    if (!thread || thread.authorId !== args.authorId) throw new ConvexError({ code: "UNAUTHORIZED" });
    if (
      thread.worktreeStatus !== "provisioning"
      || thread.worktreeProvisionAttemptId !== args.attemptId
    ) {
      return false;
    }
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      worktreeStatus: "failed",
      worktreeProvisionAttemptId: undefined,
      worktreeError: shortError(args.error),
      worktreeUpdatedAt: now,
      updatedAt: now,
    });
    return true;
  },
});

export const completeGithubPullRequestCheckout = mutation({
  args: {
    threadId: v.string(),
    worktreePath: v.string(),
    headSha: v.string(),
    upstreamBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    if (!thread.githubPullRequestHeadSha || thread.worktreePath !== args.worktreePath) {
      throw new ConvexError({ code: "PULL_REQUEST_CHECKOUT_MISMATCH" });
    }
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      headSha: args.headSha,
      upstreamBranch: args.upstreamBranch,
      worktreeStatus: "ready",
      worktreeProvisionAttemptId: undefined,
      worktreeError: undefined,
      worktreeUpdatedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const failGithubPullRequestCheckout = mutation({
  args: { threadId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      worktreeStatus: "failed",
      worktreeProvisionAttemptId: undefined,
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
      worktreeProvisionAttemptId: undefined,
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

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_author_project", (q) => q.eq("authorId", identity.subject).eq("projectId", args.projectId))
      .order("desc")
      .collect();

    return await Promise.all(threads.map(async (thread) => {
      const message = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread.threadId))
        .first();
      return { ...thread, hasMessages: Boolean(message) };
    }));
  },
});

export const listForSidebar = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    return await ctx.db
      .query("threads")
      .withIndex("by_author", (q) => q.eq("authorId", identity.subject))
      .order("desc")
      .collect();
  },
});

export const updateTitle = mutation({
  args: {
    threadId: v.string(),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const title = args.title.trim();
    if (!title || title.length > 200) {
      throw new ConvexError({ code: "INVALID_THREAD_TITLE" });
    }

    await ctx.db.patch(thread._id, { title, updatedAt: Date.now() });
    return null;
  },
});

export const updateGeneratedTitle = mutation({
  args: {
    threadId: v.string(),
    title: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const title = args.title.trim();
    if (!title || title.length > 200) {
      throw new ConvexError({ code: "INVALID_THREAD_TITLE" });
    }

    if (thread.title !== "New thread") return false;

    await ctx.db.patch(thread._id, { title, updatedAt: Date.now() });
    return true;
  },
});

export const updateGeneratedThreadMetadata = mutation({
  args: {
    threadId: v.string(),
    expectedBranch: v.string(),
    featureBranch: v.string(),
    title: v.optional(v.string()),
  },
  returns: v.object({
    branchUpdated: v.boolean(),
    titleUpdated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    if (
      resolveThreadWorkspaceMode(thread) !== "worktree"
      || thread.worktreeStatus !== "ready"
      || thread.featureBranch !== args.expectedBranch
      || thread.commitStatus !== undefined
      || thread.pullRequestNumber !== undefined
    ) {
      return { branchUpdated: false, titleUpdated: false };
    }

    const featureBranch = args.featureBranch.trim();
    if (!featureBranch || featureBranch.length > 120) {
      throw new ConvexError({ code: "INVALID_FEATURE_BRANCH" });
    }
    const generatedTitle = args.title?.trim();
    if (generatedTitle !== undefined && (!generatedTitle || generatedTitle.length > 200)) {
      throw new ConvexError({ code: "INVALID_THREAD_TITLE" });
    }
    const titleUpdated = thread.title === "New thread" && generatedTitle !== undefined;

    const now = Date.now();
    await ctx.db.patch(thread._id, {
      featureBranch,
      ...(titleUpdated ? { title: generatedTitle } : {}),
      gitStatusInvalidatedAt: now,
      gitStatusInvalidationReason: "manual",
      updatedAt: now,
    });
    return { branchUpdated: true, titleUpdated };
  },
});

export const setSettlement = mutation({
  args: {
    threadId: v.string(),
    settled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    if (args.settled && thread.isLive) {
      throw new ConvexError({
        code: "THREAD_IS_RUNNING",
        message: "A running thread cannot be settled.",
      });
    }

    const now = Date.now();
    await ctx.db.patch(thread._id, {
      settledOverride: args.settled ? "settled" : "active",
      settledAt: args.settled ? now : undefined,
      updatedAt: now,
    });
    return null;
  },
});

export const setAgentModelSelection = mutation({
  args: {
    threadId: v.string(),
    provider: v.union(v.literal("openai-codex"), v.literal("xai")),
    model: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!thread || thread.authorId !== authorId) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const model = args.model.trim();
    if (!model || model.length > 200) {
      throw new ConvexError({ code: "INVALID_AGENT_MODEL_SELECTION" });
    }

    await ctx.db.patch(thread._id, {
      agentProvider: args.provider,
      agentModel: model,
    });
    return null;
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
      currentRunTransport: "session",
      isLive: true,
      settledOverride: undefined,
      settledAt: undefined,
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
        currentRunTransport: undefined,
        isLive: false,
        updatedAt: now,
      });

      return null;
    }

    await ctx.db.patch(thread._id, {
      currentRunId: args.runId,
      currentRunTransport: "task",
      isLive: true,
      settledOverride: undefined,
      settledAt: undefined,
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
  options: { replaceSameRun?: boolean } = {},
) {
  if (thread.currentRunId && thread.currentRunId !== issue.runId) {
    return null;
  }

  if (thread.agentRunIssue?.runId === issue.runId && !options.replaceSameRun) {
    return null;
  }

  await ctx.db.patch(thread._id, {
    currentRunId: undefined,
    currentRunTransport: undefined,
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
    // Realtime reconciliation can observe Trigger's generic failure wrapper
    // before this task-level persistence call arrives. The task owns the root
    // exception, so let it replace a same-run generic issue without allowing
    // older or unrelated runs to overwrite current state.
    const result = await applyRunIssue(ctx, thread, args.issue, {
      replaceSameRun: true,
    });
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
    currentRunTransport: undefined,
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
  v.literal("push_create_pr"),
  v.literal("commit_push_create_pr"),
  v.literal("push"),
  v.literal("pull"),
  v.literal("create_pr"),
  v.literal("rename_branch"),
);

const gitOperationInputValidator = {
  commitMessage: v.optional(v.string()),
  pullRequestTitle: v.optional(v.string()),
  pullRequestBody: v.optional(v.string()),
  pullRequestDraft: v.optional(v.boolean()),
};

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

export const getGitOperation = query({
  args: { threadId: v.string(), operationId: v.string() },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    const operation = await ctx.db
      .query("gitOperations")
      .withIndex("by_operation_id", (q) => q.eq("operationId", args.operationId))
      .unique();
    return operation?.threadId === thread.threadId ? operation : null;
  },
});

export const getLatestGitOperation = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    await requireThreadForAuthor(ctx, args.threadId);
    return ctx.db
      .query("gitOperations")
      .withIndex("by_thread_created", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .first();
  },
});

export const beginGitOperation = mutation({
  args: {
    threadId: v.string(),
    projectId: v.string(),
    operationId: v.string(),
    action: gitWorkflowActionValidator,
    ...gitOperationInputValidator,
  },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    if (thread.projectId !== args.projectId) {
      throw new ConvexError({ code: "THREAD_NOT_FOUND" });
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("gitOperations")
      .withIndex("by_operation_id", (q) => q.eq("operationId", args.operationId))
      .unique();

    if (existing && (
      existing.threadId !== args.threadId ||
      existing.authorId !== thread.authorId ||
      existing.requestedAction !== args.action
    )) {
      throw new ConvexError({ code: "OPERATION_ID_CONFLICT" });
    }

    if (existing?.status === "succeeded") {
      return { acquired: false as const, reason: "completed" as const, operation: existing };
    }

    const leaseActive = Boolean(
      thread.gitMutationId &&
      thread.gitMutationStartedAt &&
      thread.gitMutationStartedAt > now - GIT_MUTATION_LEASE_MS,
    );
    if (leaseActive) {
      return {
        acquired: false as const,
        reason: thread.gitMutationId === args.operationId ? "running" as const : "conflict" as const,
        activeAction: thread.gitMutationAction,
        operation: existing ?? null,
      };
    }

    let operation;
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "running",
        currentPhase: nextGitWorkflowPhase(existing.requestedAction, existing.phaseResults),
        failure: undefined,
        attempt: existing.attempt + 1,
        updatedAt: now,
        completedAt: undefined,
      });
      operation = await ctx.db.get(existing._id);
    } else {
      const id = await ctx.db.insert("gitOperations", {
        operationId: args.operationId,
        threadId: args.threadId,
        projectId: args.projectId,
        authorId: thread.authorId,
        requestedAction: args.action,
        status: "running",
        currentPhase: nextGitWorkflowPhase(args.action, []),
        phaseResults: [],
        commitMessage: args.commitMessage,
        pullRequestTitle: args.pullRequestTitle,
        pullRequestBody: args.pullRequestBody,
        pullRequestDraft: args.pullRequestDraft,
        attempt: 1,
        createdAt: now,
        updatedAt: now,
      });
      operation = await ctx.db.get(id);
    }

    await ctx.db.patch(thread._id, {
      gitMutationId: args.operationId,
      gitMutationAction: args.action,
      gitMutationStartedAt: now,
      updatedAt: now,
    });
    return { acquired: true as const, operation };
  },
});

type StoredGitPhaseResult = Doc<"gitOperations">["phaseResults"][number];

function replacePhaseResult(
  results: StoredGitPhaseResult[],
  result: StoredGitPhaseResult,
) {
  return [...results.filter((item) => item.phase !== result.phase), result];
}

export const startGitOperationPhase = mutation({
  args: {
    threadId: v.string(),
    operationId: v.string(),
    phase: gitWorkflowPhaseValidator,
  },
  handler: async (ctx, args) => {
    await requireThreadForAuthor(ctx, args.threadId);
    const operation = await ctx.db.query("gitOperations")
      .withIndex("by_operation_id", (q) => q.eq("operationId", args.operationId)).unique();
    if (!operation || operation.threadId !== args.threadId) throw new ConvexError({ code: "OPERATION_NOT_FOUND" });
    const now = Date.now();
    const result = { phase: args.phase, status: "running" as const, startedAt: now };
    await ctx.db.patch(operation._id, {
      status: "running",
      currentPhase: args.phase,
      phaseResults: replacePhaseResult(operation.phaseResults, result),
      updatedAt: now,
    });
    return null;
  },
});

export const completeGitOperationPhase = mutation({
  args: {
    threadId: v.string(),
    operationId: v.string(),
    result: gitWorkflowPhaseResultValidator,
    branch: v.optional(v.string()),
    baseBranch: v.optional(v.string()),
    commitSha: v.optional(v.string()),
    commitMessage: v.optional(v.string()),
    pushResult: v.optional(gitWorkflowPushResultValidator),
    pullRequestNumber: v.optional(v.number()),
    pullRequestUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireThreadForAuthor(ctx, args.threadId);
    const operation = await ctx.db.query("gitOperations")
      .withIndex("by_operation_id", (q) => q.eq("operationId", args.operationId)).unique();
    if (!operation || operation.threadId !== args.threadId) throw new ConvexError({ code: "OPERATION_NOT_FOUND" });
    const phaseResults = replacePhaseResult(operation.phaseResults, args.result);
    await ctx.db.patch(operation._id, {
      phaseResults,
      currentPhase: nextGitWorkflowPhase(operation.requestedAction, phaseResults),
      branch: args.branch ?? operation.branch,
      baseBranch: args.baseBranch ?? operation.baseBranch,
      commitSha: args.commitSha ?? operation.commitSha,
      commitMessage: args.commitMessage ?? operation.commitMessage,
      pushResult: args.pushResult ?? operation.pushResult,
      pullRequestNumber: args.pullRequestNumber ?? operation.pullRequestNumber,
      pullRequestUrl: args.pullRequestUrl ?? operation.pullRequestUrl,
      failure: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const failGitOperation = mutation({
  args: {
    threadId: v.string(),
    operationId: v.string(),
    result: gitWorkflowPhaseResultValidator,
    failure: gitWorkflowFailureValidator,
  },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    const operation = await ctx.db.query("gitOperations")
      .withIndex("by_operation_id", (q) => q.eq("operationId", args.operationId)).unique();
    if (!operation || operation.threadId !== args.threadId) throw new ConvexError({ code: "OPERATION_NOT_FOUND" });
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "failed",
      currentPhase: args.failure.phase,
      phaseResults: replacePhaseResult(operation.phaseResults, args.result),
      failure: args.failure,
      updatedAt: now,
      completedAt: now,
    });
    if (thread.gitMutationId === args.operationId) {
      await ctx.db.patch(thread._id, {
        gitMutationId: undefined,
        gitMutationAction: undefined,
        gitMutationStartedAt: undefined,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const completeGitOperation = mutation({
  args: { threadId: v.string(), operationId: v.string() },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    const operation = await ctx.db.query("gitOperations")
      .withIndex("by_operation_id", (q) => q.eq("operationId", args.operationId)).unique();
    if (!operation || operation.threadId !== args.threadId) throw new ConvexError({ code: "OPERATION_NOT_FOUND" });
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "succeeded",
      currentPhase: undefined,
      failure: undefined,
      updatedAt: now,
      completedAt: now,
    });
    if (thread.gitMutationId === args.operationId) {
      await ctx.db.patch(thread._id, {
        gitMutationId: undefined,
        gitMutationAction: undefined,
        gitMutationStartedAt: undefined,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const releaseGitOperationLease = mutation({
  args: { threadId: v.string(), operationId: v.string() },
  handler: async (ctx, args) => {
    const thread = await requireThreadForAuthor(ctx, args.threadId);
    if (thread.gitMutationId !== args.operationId) return null;

    await ctx.db.patch(thread._id, {
      gitMutationId: undefined,
      gitMutationAction: undefined,
      gitMutationStartedAt: undefined,
      updatedAt: Date.now(),
    });
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
    const gitOperations = await ctx.db
      .query("gitOperations")
      .withIndex("by_thread_created", (q) => q.eq("threadId", args.threadId))
      .collect();

    await deleteAssistantPartsBlobKeys(
      ctx as unknown as AssistantPartsBlobDeleteCtx,
      collectAssistantPartsBlobKeys(messages),
    );
    await Promise.all(messages.map((message) => ctx.db.delete(message._id)));
    await Promise.all(gitOperations.map((operation) => ctx.db.delete(operation._id)));
    await ctx.db.delete(thread._id);

    return { projectId: thread.projectId };
  },
});
