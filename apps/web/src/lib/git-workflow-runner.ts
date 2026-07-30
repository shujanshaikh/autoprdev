import type {
  GitWorkflowAction,
  GitWorkflowFailure,
  GitWorkflowPhase,
  GitWorkflowPhaseResult,
  GitWorkflowPushResult,
} from "@autopr/backend/convex/lib/gitWorkflow";
import { phasesForGitWorkflowAction } from "@autopr/backend/convex/lib/gitWorkflow";

export type GitWorkflowCheckpoint = {
  branch?: string;
  baseBranch?: string;
  commitSha?: string;
  commitMessage?: string;
  pushResult?: GitWorkflowPushResult;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
};

export type GitWorkflowPhaseOutput = GitWorkflowCheckpoint & {
  status?: "succeeded" | "skipped";
  summary: string;
  diagnostics?: string;
};

export class GitWorkflowPhaseError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly recoveryAction?: string;
  readonly diagnostics?: string;

  constructor(options: {
    code: string;
    message: string;
    retryable?: boolean;
    recoveryAction?: string;
    diagnostics?: string;
  }) {
    super(options.message);
    this.name = "GitWorkflowPhaseError";
    this.code = options.code;
    this.retryable = options.retryable ?? true;
    this.recoveryAction = options.recoveryAction;
    this.diagnostics = options.diagnostics;
  }
}

export type GitWorkflowPhaseHandlers = Record<
  GitWorkflowPhase,
  (checkpoint: GitWorkflowCheckpoint) => Promise<GitWorkflowPhaseOutput>
>;

function failureFor(error: unknown, phase: GitWorkflowPhase): GitWorkflowFailure {
  if (error instanceof GitWorkflowPhaseError) {
    return {
      code: error.code,
      message: error.message,
      phase,
      retryable: error.retryable,
      recoveryAction: error.recoveryAction,
      diagnostics: error.diagnostics,
    };
  }
  return {
    code: "GIT_WORKFLOW_PHASE_FAILED",
    message: error instanceof Error ? error.message : "The Git operation failed.",
    phase,
    retryable: true,
    recoveryAction: "Fix the reported issue, then retry this operation. Completed phases will be preserved.",
  };
}

export async function executeResumableGitWorkflow(options: {
  action: GitWorkflowAction;
  phaseResults: readonly GitWorkflowPhaseResult[];
  checkpoint: GitWorkflowCheckpoint;
  handlers: GitWorkflowPhaseHandlers;
  onPhaseStart: (phase: GitWorkflowPhase) => Promise<void>;
  onPhaseComplete: (
    result: GitWorkflowPhaseResult,
    checkpoint: GitWorkflowCheckpoint,
  ) => Promise<void>;
  onPhaseFailure: (result: GitWorkflowPhaseResult, failure: GitWorkflowFailure) => Promise<void>;
}) {
  const completed = new Set(
    options.phaseResults
      .filter((result) => result.status === "succeeded" || result.status === "skipped")
      .map((result) => result.phase),
  );
  let checkpoint = { ...options.checkpoint };

  for (const phase of phasesForGitWorkflowAction(options.action)) {
    if (completed.has(phase)) continue;
    const startedAt = Date.now();
    await options.onPhaseStart(phase);
    try {
      const output = await options.handlers[phase](checkpoint);
      checkpoint = {
        ...checkpoint,
        branch: output.branch ?? checkpoint.branch,
        baseBranch: output.baseBranch ?? checkpoint.baseBranch,
        commitSha: output.commitSha ?? checkpoint.commitSha,
        commitMessage: output.commitMessage ?? checkpoint.commitMessage,
        pushResult: output.pushResult ?? checkpoint.pushResult,
        pullRequestNumber: output.pullRequestNumber ?? checkpoint.pullRequestNumber,
        pullRequestUrl: output.pullRequestUrl ?? checkpoint.pullRequestUrl,
      };
      const result: GitWorkflowPhaseResult = {
        phase,
        status: output.status ?? "succeeded",
        startedAt,
        completedAt: Date.now(),
        summary: output.summary,
        diagnostics: output.diagnostics,
      };
      await options.onPhaseComplete(result, checkpoint);
    } catch (error) {
      const failure = failureFor(error, phase);
      const result: GitWorkflowPhaseResult = {
        phase,
        status: "failed",
        startedAt,
        completedAt: Date.now(),
        summary: failure.message,
        diagnostics: failure.diagnostics,
        failure,
      };
      await options.onPhaseFailure(result, failure);
      throw new GitWorkflowPhaseError(failure);
    }
  }

  return checkpoint;
}
