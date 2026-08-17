import type { ActionCtx, MutationCtx } from "../_generated/server";
import { r2 } from "../imageUploads";

export type R2ActionCtx = Parameters<typeof r2.store>[0];
export type R2MutationCtx = Parameters<typeof r2.deleteObject>[0];

function actionCandidate(ctx: ActionCtx): ActionCtx | R2ActionCtx {
  return ctx;
}

function mutationCandidate(ctx: MutationCtx | ActionCtx): MutationCtx | ActionCtx | R2MutationCtx {
  return ctx;
}

/** Bridges Convex's React-peer-specific type identities at the R2 boundary. */
export function asR2ActionContext(ctx: ActionCtx): R2ActionCtx {
  const compatible = actionCandidate(ctx);
  return /* SAFETY: Both peer variants expose the same Convex runtime methods; only their installed React peer identities differ. */ compatible as R2ActionCtx;
}

/** Bridges Convex's React-peer-specific type identities at the R2 boundary. */
export function asR2MutationContext(ctx: MutationCtx | ActionCtx): R2MutationCtx {
  const compatible = mutationCandidate(ctx);
  return /* SAFETY: Both peer variants expose the same Convex runtime methods; only their installed React peer identities differ. */ compatible as R2MutationCtx;
}
