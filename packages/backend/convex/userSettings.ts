import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { getUserSettingsForAuthor } from "./lib/userSettings";

const userSettingsValidator = v.object({
  demoRecordingExperimentEnabled: v.boolean(),
});

export const get = query({
  args: {},
  returns: userSettingsValidator,
  handler: async (ctx) => {
    const authorId = await requireUserId(ctx);

    return getUserSettingsForAuthor(ctx, authorId);
  },
});

export const setDemoRecordingExperimentEnabled = mutation({
  args: {
    enabled: v.boolean(),
  },
  returns: userSettingsValidator,
  handler: async (ctx, args) => {
    const authorId = await requireUserId(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_author", (q) => q.eq("authorId", authorId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        demoRecordingExperimentEnabled: args.enabled,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("userSettings", {
        authorId,
        demoRecordingExperimentEnabled: args.enabled,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      demoRecordingExperimentEnabled: args.enabled,
    };
  },
});
