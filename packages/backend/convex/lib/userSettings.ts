import { ConvexError } from "convex/values";

import type { MutationCtx, QueryCtx } from "../_generated/server";

type UserSettingsCtx = QueryCtx | MutationCtx;

export async function getUserSettingsForAuthor(ctx: UserSettingsCtx, authorId: string) {
  const settings = await ctx.db
    .query("userSettings")
    .withIndex("by_author", (q) => q.eq("authorId", authorId))
    .unique();

  return {
    demoRecordingExperimentEnabled: Boolean(settings?.demoRecordingExperimentEnabled),
  };
}

export async function requireDemoRecordingExperimentEnabled(ctx: UserSettingsCtx, authorId: string) {
  const settings = await getUserSettingsForAuthor(ctx, authorId);

  if (!settings.demoRecordingExperimentEnabled) {
    throw new ConvexError({ code: "DEMO_RECORDING_EXPERIMENT_DISABLED" });
  }
}
