import type { GitWorkflowFailure, GitWorkflowPhase, GitWorkflowPhaseResult } from "@autopr/backend/convex/lib/gitWorkflow";
import { phasesForGitWorkflowAction } from "@autopr/backend/convex/lib/gitWorkflow";
import { describe, expect, it, vi } from "vitest";

import { executeResumableGitWorkflow, GitWorkflowPhaseError, type GitWorkflowPhaseHandlers } from "./git-workflow-runner";

function persistedCallbacks(results: GitWorkflowPhaseResult[]) {
  return {
    onPhaseStart: vi.fn(async () => undefined),
    onPhaseComplete: vi.fn(async (result: GitWorkflowPhaseResult) => {
      results.splice(0, results.length, ...results.filter((item) => item.phase !== result.phase), result);
    }),
    onPhaseFailure: vi.fn(async (result: GitWorkflowPhaseResult, _failure: GitWorkflowFailure) => {
      results.splice(0, results.length, ...results.filter((item) => item.phase !== result.phase), result);
    }),
  };
}

function successfulHandlers(calls: GitWorkflowPhase[]) {
  const handler = (phase: GitWorkflowPhase) => async () => {
    calls.push(phase);
    return { summary: `${phase} complete` };
  };
  return {
    branch: handler("branch"),
    validate: handler("validate"),
    commit: handler("commit"),
    push: handler("push"),
    pull_request: handler("pull_request"),
  } satisfies GitWorkflowPhaseHandlers;
}

describe("executeResumableGitWorkflow", () => {
  it("maps all requested actions to only their required phases", () => {
    expect(phasesForGitWorkflowAction("commit")).toEqual(["branch", "validate", "commit"]);
    expect(phasesForGitWorkflowAction("push")).toEqual(["branch", "validate", "push"]);
    expect(phasesForGitWorkflowAction("create_pr")).toEqual(["branch", "validate", "push", "pull_request"]);
    expect(phasesForGitWorkflowAction("commit_push")).toEqual(["branch", "validate", "commit", "push"]);
    expect(phasesForGitWorkflowAction("push_create_pr")).toEqual(["branch", "validate", "push", "pull_request"]);
    expect(phasesForGitWorkflowAction("commit_push_create_pr")).toEqual([
      "branch",
      "validate",
      "commit",
      "push",
      "pull_request",
    ]);
  });

  for (const failedPhase of ["branch", "validate", "commit", "push", "pull_request"] as const) {
    it(`retries from the failed ${failedPhase} phase`, async () => {
      const results: GitWorkflowPhaseResult[] = [];
      const firstCalls: GitWorkflowPhase[] = [];
      const firstHandlers = successfulHandlers(firstCalls);
      firstHandlers[failedPhase] = async () => {
        firstCalls.push(failedPhase);
        throw new GitWorkflowPhaseError({ code: "INJECTED", message: "Injected failure" });
      };
      await expect(executeResumableGitWorkflow({
        action: "commit_push_create_pr",
        phaseResults: results,
        checkpoint: {},
        handlers: firstHandlers,
        ...persistedCallbacks(results),
      })).rejects.toMatchObject({ code: "INJECTED" });

      const retryCalls: GitWorkflowPhase[] = [];
      await executeResumableGitWorkflow({
        action: "commit_push_create_pr",
        phaseResults: results,
        checkpoint: {},
        handlers: successfulHandlers(retryCalls),
        ...persistedCallbacks(results),
      });

      const failedIndex = ["branch", "validate", "commit", "push", "pull_request"].indexOf(failedPhase);
      expect(retryCalls).toEqual(["branch", "validate", "commit", "push", "pull_request"].slice(failedIndex));
      expect(results.every((result) => result.status === "succeeded")).toBe(true);
    });
  }

  it("treats a duplicate completed request as a no-op", async () => {
    const phases = ["branch", "validate", "commit", "push", "pull_request"] as const;
    const results: GitWorkflowPhaseResult[] = phases.map((phase) => ({
      phase,
      status: "succeeded",
      startedAt: 1,
      completedAt: 2,
    }));
    const calls: GitWorkflowPhase[] = [];
    await executeResumableGitWorkflow({
      action: "commit_push_create_pr",
      phaseResults: results,
      checkpoint: { commitSha: "abc" },
      handlers: successfulHandlers(calls),
      ...persistedCallbacks(results),
    });
    expect(calls).toEqual([]);
  });

  it("resumes after reconnect from persisted phase results", async () => {
    const results: GitWorkflowPhaseResult[] = ["branch", "validate", "commit"].map((phase) => ({
      phase: /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ phase as GitWorkflowPhase,
      status: "succeeded",
      startedAt: 1,
      completedAt: 2,
    }));
    const calls: GitWorkflowPhase[] = [];
    await executeResumableGitWorkflow({
      action: "commit_push_create_pr",
      phaseResults: results,
      checkpoint: { commitSha: "abc", branch: "autopr/test" },
      handlers: successfulHandlers(calls),
      ...persistedCallbacks(results),
    });
    expect(calls).toEqual(["push", "pull_request"]);
  });

  it("records an existing remote branch and existing PR as idempotent skips", async () => {
    const results: GitWorkflowPhaseResult[] = [];
    const handlers = successfulHandlers([]);
    handlers.push = async () => ({
      status: "skipped",
      summary: "Commit abc was already on GitHub",
      pushResult: { commitSha: "abc", remoteSha: "abc", pushed: false, alreadyPushed: true },
    });
    handlers.pull_request = async () => ({
      status: "skipped",
      summary: "Found existing pull request #42",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/acme/repo/pull/42",
    });
    const checkpoint = await executeResumableGitWorkflow({
      action: "push_create_pr",
      phaseResults: results,
      checkpoint: {},
      handlers,
      ...persistedCallbacks(results),
    });
    expect(checkpoint.pushResult?.alreadyPushed).toBe(true);
    expect(checkpoint.pullRequestNumber).toBe(42);
    expect(results.filter((result) => result.status === "skipped").map((result) => result.phase))
      .toEqual(["push", "pull_request"]);
  });
});
