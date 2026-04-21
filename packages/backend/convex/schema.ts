import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    authorId: v.string(),
    githubUrl: v.string(),
    cloneUrl: v.string(),
    repoFullName: v.string(),
    repoOwner: v.string(),
    repoName: v.string(),
    repoBranch: v.optional(v.string()),
    sandboxCacheKey: v.string(),
    sandboxId: v.optional(v.string()),
    sandboxName: v.optional(v.string()),
    sandboxSnapshot: v.optional(v.string()),
    sandboxWorkDir: v.optional(v.string()),
    sandboxStatus: v.union(v.literal("creating"), v.literal("ready"), v.literal("failed")),
    sandboxError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastOpenedAt: v.optional(v.number()),
  })
    .index("by_author", ["authorId"])
    .index("by_author_repo", ["authorId", "repoFullName"]),

  threads: defineTable({
    projectId: v.id("projects"),
    authorId: v.string(),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    currentRunId: v.optional(v.string()),
    isLive: v.optional(v.boolean()),
  })
    .index("by_project", ["projectId"])
    .index("by_author_project", ["authorId", "projectId"]),

  messages: defineTable({
    threadId: v.id("threads"),
    projectId: v.id("projects"),
    authorId: v.string(),
    messageId: v.string(),
    role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
    parts: v.array(v.any()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_message_id", ["messageId"])
    .index("by_project", ["projectId"]),
});
