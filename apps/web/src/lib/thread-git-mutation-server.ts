import "@tanstack/react-start/server-only";

import { api } from "@autopr/backend/convex/_generated/api";

import { convexMutation } from "#/lib/convex-server";
import type { ThreadGitAction } from "#/lib/thread-git-actions";

type MutableThreadGitAction = Exclude<ThreadGitAction, "view_pr">;
type InternalThreadGitAction = MutableThreadGitAction | "rename_branch";

export class ThreadGitMutationConflictError extends Error {
  constructor(activeAction?: string) {
    super(
      activeAction
        ? `Another Git operation (${activeAction.replace("_", " ")}) is already running for this thread.`
        : "Another Git operation is already running for this thread.",
    );
    this.name = "ThreadGitMutationConflictError";
  }
}

export async function withThreadGitMutation<T>(options: {
  threadId: string;
  action: InternalThreadGitAction;
  run: () => Promise<T>;
}): Promise<T> {
  const mutationId = crypto.randomUUID();
  const lock = await convexMutation(api.threads.beginGitMutation, {
    threadId: options.threadId,
    mutationId,
    action: options.action,
  });

  if (!lock.acquired) {
    throw new ThreadGitMutationConflictError(lock.activeAction);
  }

  try {
    return await options.run();
  } finally {
    await convexMutation(api.threads.endGitMutation, {
      threadId: options.threadId,
      mutationId,
    }).catch(() => undefined);
  }
}
