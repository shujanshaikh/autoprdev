import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    projectId: v.string(),
    authorId: v.string(),
    githubUrl: v.string(),
    cloneUrl: v.string(),
    repoFullName: v.string(),
    repoOwner: v.string(),
    repoName: v.string(),
    repoBranch: v.optional(v.string()),
    githubProvider: v.optional(v.union(v.literal("oauth"))),
    githubRepositoryId: v.optional(v.number()),
    defaultBranch: v.optional(v.string()),
    currentBranch: v.optional(v.string()),
    branchSwitchStatus: v.optional(v.union(v.literal("idle"), v.literal("switching"), v.literal("failed"))),
    branchSwitchError: v.optional(v.string()),
    branchSwitchedAt: v.optional(v.number()),
    sandboxCacheKey: v.string(),
    sandboxId: v.optional(v.string()),
    sandboxName: v.optional(v.string()),
    sandboxSnapshot: v.optional(v.string()),
    sandboxWorkDir: v.optional(v.string()),
    sandboxStatus: v.union(v.literal("creating"), v.literal("ready"), v.literal("failed")),
    sandboxRuntimeStatus: v.optional(v.union(v.literal("started"), v.literal("stopped"), v.literal("archived"), v.literal("unknown"))),
    sandboxRuntimeCheckedAt: v.optional(v.number()),
    sandboxError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastOpenedAt: v.optional(v.number()),
  })
    .index("by_author", ["authorId"])
    .index("by_author_repo", ["authorId", "repoFullName"])
    .index("by_project_id", ["projectId"]),

  sandboxCosts: defineTable({
    authorId: v.string(),
    projectId: v.string(),
    sandboxId: v.string(),
    sandboxName: v.optional(v.string()),
    repoFullName: v.optional(v.string()),
    daytonaOrganizationId: v.string(),
    status: v.union(v.literal("active"), v.literal("pending_finalization"), v.literal("finalized")),
    latestTotalPrice: v.optional(v.number()),
    finalTotalPrice: v.optional(v.number()),
    currency: v.optional(v.string()),
    sandboxCreatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    lastSyncedAt: v.optional(v.number()),
    finalizedAt: v.optional(v.number()),
    syncError: v.optional(v.string()),
    finalizationAttempts: v.number(),
    nextSyncAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_author", ["authorId"])
    .index("by_sandbox_id", ["sandboxId"])
    .index("by_author_status", ["authorId", "status"])
    .index("by_next_sync", ["nextSyncAt"]),

  codexCredentials: defineTable({
    authorId: v.string(),
    organizationId: v.string(),
    vaultObjectId: v.string(),
    vaultVersionId: v.optional(v.string()),
    accountId: v.optional(v.string()),
    email: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    connectedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_author", ["authorId"]),

  userSettings: defineTable({
    authorId: v.string(),
    demoRecordingExperimentEnabled: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_author", ["authorId"]),

  threads: defineTable({
    threadId: v.string(),
    projectId: v.string(),
    authorId: v.string(),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    currentRunId: v.optional(v.string()),
    isLive: v.optional(v.boolean()),
    workflowIssue: v.optional(v.object({
      workflowRunId: v.string(),
      stepName: v.optional(v.string()),
      attempt: v.optional(v.number()),
      retryCount: v.optional(v.number()),
      message: v.string(),
      errorStack: v.optional(v.string()),
      occurredAt: v.number(),
    })),
    demoEnabled: v.optional(v.boolean()),
    pullRequestStatus: v.optional(v.union(v.literal("idle"), v.literal("creating"), v.literal("created"), v.literal("failed"))),
    pullRequestUrl: v.optional(v.string()),
    pullRequestNumber: v.optional(v.number()),
    pullRequestBranch: v.optional(v.string()),
    pullRequestError: v.optional(v.string()),
    pullRequestCreatedAt: v.optional(v.number()),
    commitStatus: v.optional(v.union(v.literal("committed"), v.literal("pushed"))),
    commitBranch: v.optional(v.string()),
    commitSha: v.optional(v.string()),
    commitMessage: v.optional(v.string()),
    committedAt: v.optional(v.number()),
  })
    .index("by_thread_id", ["threadId"])
    .index("by_project", ["projectId"])
    .index("by_author_project", ["authorId", "projectId"]),

  messages: defineTable({
    threadId: v.string(),
    projectId: v.string(),
    authorId: v.string(),
    messageId: v.string(),
    role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
    parts: v.array(v.any()),
    partsR2Key: v.optional(v.string()),
    partsBlobContentType: v.optional(v.string()),
    partsBlobSizeBytes: v.optional(v.number()),
    partsBlobSha256: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_message_id", ["messageId"])
    .index("by_project", ["projectId"]),

  uploadedImages: defineTable({
    authorId: v.string(),
    key: v.string(),
    bucket: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_author", ["authorId"]),

  recordingArtifacts: defineTable({
    authorId: v.string(),
    projectId: v.string(),
    threadId: v.string(),
    recordingId: v.string(),
    r2Key: v.optional(v.string()),
    sourceFileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    status: v.union(v.literal("uploading"), v.literal("uploaded"), v.literal("failed")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    uploadedAt: v.optional(v.number()),
  })
    .index("by_thread_recording", ["threadId", "recordingId"])
    .index("by_project", ["projectId"])
    .index("by_author", ["authorId"]),
});
