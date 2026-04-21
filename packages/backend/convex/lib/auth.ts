import { ConvexError } from "convex/values";

import type { MutationCtx, QueryCtx } from "../_generated/server";

type AuthenticatedCtx = QueryCtx | MutationCtx;

export async function requireUserId(ctx: AuthenticatedCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }

  return identity.subject;
}
