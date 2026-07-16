import { type Infer, v } from "convex/values";

export const gitWorkflowActionValidator = v.union(
  v.literal("commit"),
  v.literal("push"),
  v.literal("create_pr"),
  v.literal("commit_push"),
  v.literal("push_create_pr"),
  v.literal("commit_push_create_pr"),
);

export const gitWorkflowPhaseValidator = v.union(
  v.literal("branch"),
  v.literal("validate"),
  v.literal("commit"),
  v.literal("push"),
  v.literal("pull_request"),
);

export const gitWorkflowPhaseStatusValidator = v.union(
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("skipped"),
  v.literal("failed"),
);

export const gitWorkflowFailureValidator = v.object({
  code: v.string(),
  message: v.string(),
  phase: gitWorkflowPhaseValidator,
  retryable: v.boolean(),
  recoveryAction: v.optional(v.string()),
  diagnostics: v.optional(v.string()),
});

export const gitWorkflowPhaseResultValidator = v.object({
  phase: gitWorkflowPhaseValidator,
  status: gitWorkflowPhaseStatusValidator,
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  summary: v.optional(v.string()),
  diagnostics: v.optional(v.string()),
  failure: v.optional(gitWorkflowFailureValidator),
});

export const gitWorkflowPushResultValidator = v.object({
  commitSha: v.string(),
  remoteSha: v.string(),
  pushed: v.boolean(),
  alreadyPushed: v.boolean(),
});

export type GitWorkflowAction = Infer<typeof gitWorkflowActionValidator>;
export type GitWorkflowPhase = Infer<typeof gitWorkflowPhaseValidator>;
export type GitWorkflowPhaseStatus = Infer<typeof gitWorkflowPhaseStatusValidator>;
export type GitWorkflowFailure = Infer<typeof gitWorkflowFailureValidator>;
export type GitWorkflowPhaseResult = Infer<typeof gitWorkflowPhaseResultValidator>;
export type GitWorkflowPushResult = Infer<typeof gitWorkflowPushResultValidator>;

export const gitWorkflowPhases: GitWorkflowPhase[] = [
  "branch",
  "validate",
  "commit",
  "push",
  "pull_request",
];

const actionPhases: Record<GitWorkflowAction, GitWorkflowPhase[]> = {
  commit: ["branch", "validate", "commit"],
  push: ["branch", "validate", "push"],
  create_pr: ["branch", "validate", "pull_request"],
  commit_push: ["branch", "validate", "commit", "push"],
  push_create_pr: ["branch", "validate", "push", "pull_request"],
  commit_push_create_pr: ["branch", "validate", "commit", "push", "pull_request"],
};

export function phasesForGitWorkflowAction(action: GitWorkflowAction) {
  return actionPhases[action];
}

export function nextGitWorkflowPhase(
  action: GitWorkflowAction,
  results: readonly GitWorkflowPhaseResult[],
): GitWorkflowPhase | undefined {
  const completed = new Set(
    results
      .filter((result) => result.status === "succeeded" || result.status === "skipped")
      .map((result) => result.phase),
  );
  return phasesForGitWorkflowAction(action).find((phase) => !completed.has(phase));
}
