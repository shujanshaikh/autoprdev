import "@tanstack/react-start/server-only";

import { api } from "@autopr/backend/convex/_generated/api";
import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import {
  createGithubPullRequest,
  fetchGithubPullRequestForBranch,
} from "@autopr/backend/convex/lib/github_oauth";
import type { GitWorkflowAction, GitWorkflowPhase } from "@autopr/backend/convex/lib/gitWorkflow";
import { resolveGithubPullRequestHead } from "@autopr/backend/convex/lib/githubPullRequest";

import { convexAction, convexMutation, convexQuery } from "#/lib/convex-server";
import { CodexConnectionError } from "#/lib/codex-auth-server";
import { generateCommitMessage } from "#/lib/commit-messages";
import {
  generateBranchName,
  generateCommitMetadata,
  generatePullRequestContent,
} from "#/lib/generated-git-metadata";
import {
  commitPreparedProjectSandboxChanges,
  createProjectSandboxFeatureBranch,
  inspectProjectSandboxGit,
  prepareProjectSandboxCommit,
  pushProjectSandboxBranchIfNeeded,
  readProjectSandboxPullRequestContext,
  SandboxGitCommandError,
  SandboxNoChangesError,
  validatePreparedProjectSandboxCommit,
} from "#/lib/daytona-project-sandbox";
import { redactGitDiagnostic } from "#/lib/git-diagnostics";
import {
  executeResumableGitWorkflow,
  GitWorkflowPhaseError,
  type GitWorkflowCheckpoint,
  type GitWorkflowPhaseOutput,
} from "#/lib/git-workflow-runner";
import {
  getGithubOAuthToken,
  getGithubRepositoryToken,
  getGithubRepositoryTokenForFullName,
  getGithubUserIdentity,
  GithubConnectionError,
  requireGithubRepositoryWriteAccess,
  requireWorkOSAuth,
  safeErrorMessage,
} from "#/lib/github-oauth-server";
import { ThreadGitMutationConflictError } from "#/lib/thread-git-mutation-server";
import { persistedThreadWorkspace } from "#/lib/thread-workspace-server";

export type GitWorkflowRequest = {
  operationId: string;
  action: GitWorkflowAction;
  commitMessage?: string;
  title?: string;
  body?: string;
  draft?: boolean;
};

function needsCommit(action: GitWorkflowAction) {
  return action === "commit" || action === "commit_push" || action === "commit_push_create_pr";
}

function needsGithub(action: GitWorkflowAction) {
  return action !== "commit";
}

function needsPullRequest(action: GitWorkflowAction) {
  return action === "create_pr" || action === "push_create_pr" || action === "commit_push_create_pr";
}

function needsPush(action: GitWorkflowAction) {
  return action === "push" || action === "commit_push" || action === "push_create_pr" || action === "commit_push_create_pr";
}

function phaseError(error: unknown, phase: GitWorkflowPhase) {
  if (error instanceof GitWorkflowPhaseError) return error;
  if (error instanceof SandboxNoChangesError) {
    return new GitWorkflowPhaseError({
      code: "NO_CHANGES",
      message: error.message,
      retryable: false,
      recoveryAction: "Make a change in the thread workspace, then start a new Git operation.",
    });
  }
  if (error instanceof SandboxGitCommandError) {
    return new GitWorkflowPhaseError({
      code: phase === "commit" ? "GIT_HOOK_FAILED" : "GIT_COMMAND_FAILED",
      message: error.message,
      diagnostics: error.diagnostics,
      recoveryAction: phase === "commit"
        ? "Fix the hook failure in the thread workspace, then retry this operation."
        : "Resolve the Git diagnostic, then retry this operation.",
    });
  }
  if (error instanceof GithubConnectionError) {
    return new GitWorkflowPhaseError({
      code: "GITHUB_NOT_CONNECTED",
      message: error.message,
      recoveryAction: "Reconnect GitHub, then retry this operation.",
    });
  }
  if (error instanceof CodexConnectionError) {
    return new GitWorkflowPhaseError({
      code: "COMMIT_MESSAGE_GENERATION_FAILED",
      message: error.message,
      recoveryAction: "Enter a commit message manually, then retry.",
    });
  }
  return new GitWorkflowPhaseError({
    code: `${phase.toUpperCase()}_FAILED`,
    message: redactGitDiagnostic(safeErrorMessage(error, `The ${phase.replace("_", " ")} phase failed.`)),
    recoveryAction: "Fix the reported issue, then retry this operation. Completed phases will not run again.",
  });
}

function operationResponse(operation: Doc<"gitOperations">) {
  return {
    operationId: operation.operationId,
    action: operation.requestedAction,
    status: operation.status,
    currentPhase: operation.currentPhase,
    phases: operation.phaseResults,
    branch: operation.branch,
    commitSha: operation.commitSha,
    commitMessage: operation.commitMessage,
    pushResult: operation.pushResult,
    url: operation.pullRequestUrl,
    number: operation.pullRequestNumber,
    failure: operation.failure,
  };
}

export async function runThreadGitWorkflow(options: {
  request: Request;
  projectId: string;
  threadId: string;
  input: GitWorkflowRequest;
}) {
  const [project, thread] = await Promise.all([
    convexQuery(api.projects.get, { projectId: options.projectId }),
    convexQuery(api.threads.get, { threadId: options.threadId }),
  ]);
  if (!project || !thread || thread.projectId !== options.projectId) {
    return Response.json({ error: { code: "THREAD_NOT_FOUND", message: "Thread not found." } }, { status: 404 });
  }
  if (project.sandboxStatus !== "ready" || !project.sandboxId) {
    return Response.json({
      error: { code: "PROJECT_SANDBOX_NOT_READY", message: "Project sandbox is not ready." },
    }, { status: 409 });
  }
  const sandboxId = project.sandboxId;

  const begin = await convexMutation(api.threads.beginGitOperation, {
    threadId: options.threadId,
    projectId: options.projectId,
    operationId: options.input.operationId,
    action: options.input.action,
    commitMessage: options.input.commitMessage,
    pullRequestTitle: options.input.title,
    pullRequestBody: options.input.body,
    pullRequestDraft: options.input.draft,
  });
  if (!begin.acquired) {
    if (begin.reason === "conflict") {
      throw new ThreadGitMutationConflictError(begin.activeAction);
    }
    if (begin.operation) {
      return Response.json(operationResponse(begin.operation), { status: begin.reason === "running" ? 202 : 200 });
    }
    throw new ThreadGitMutationConflictError(begin.activeAction);
  }
  const operation = begin.operation;
  if (!operation) throw new Error("Could not create the Git operation checkpoint.");

  const releaseOperationLease = () => convexMutation(api.threads.releaseGitOperationLease, {
    threadId: options.threadId,
    operationId: operation.operationId,
  });

  const failBeforeExecution = async (error: unknown, phase: GitWorkflowPhase) => {
    const failure = phaseError(error, phase);
    const now = Date.now();
    try {
      await convexMutation(api.threads.failGitOperation, {
        threadId: options.threadId,
        operationId: operation.operationId,
        failure: {
          code: failure.code,
          message: failure.message,
          phase,
          retryable: failure.retryable,
          recoveryAction: failure.recoveryAction,
          diagnostics: failure.diagnostics,
        },
        result: {
          phase,
          status: "failed",
          startedAt: now,
          completedAt: now,
          summary: failure.message,
          diagnostics: failure.diagnostics,
          failure: {
            code: failure.code,
            message: failure.message,
            phase,
            retryable: failure.retryable,
            recoveryAction: failure.recoveryAction,
            diagnostics: failure.diagnostics,
          },
        },
      });
    } finally {
      await releaseOperationLease().catch(() => undefined);
    }
    return Response.json({
      operationId: operation.operationId,
      status: "failed",
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        recoveryAction: failure.recoveryAction,
      },
    }, { status: 500 });
  };

  let authState: Awaited<ReturnType<typeof requireWorkOSAuth>>;
  try {
    authState = await requireWorkOSAuth();
  } catch (error) {
    return failBeforeExecution(error, "validate");
  }
  const fallbackEmail = authState.user.email?.trim();
  if (!fallbackEmail) return failBeforeExecution(new Error("Could not determine your commit author email."), "validate");
  let identity = {
    name: [authState.user.firstName, authState.user.lastName].filter(Boolean).join(" ").trim() || fallbackEmail,
    email: fallbackEmail,
    username: "x-access-token",
  };
  let token: string | undefined;
  let sandboxToken: string | undefined;
  let pushSandboxToken: string | undefined;
  if (needsGithub(options.input.action)) {
    try {
      token = await getGithubOAuthToken(authState.user.id, authState.organizationId);
      try {
        identity = await getGithubUserIdentity(authState.user, token);
      } catch (error) {
        if (!(error instanceof GithubConnectionError) || needsPush(options.input.action)) throw error;
      }
      if (needsPush(options.input.action)) {
        const targetFullName = thread.githubPullRequestHeadRepository
          ?? `${project.repoOwner}/${project.repoName}`;
        const [targetOwner, targetRepo, ...extra] = targetFullName.split("/");
        if (!targetOwner || !targetRepo || extra.length > 0) {
          throw new GithubConnectionError("Invalid GitHub push repository.");
        }
        await requireGithubRepositoryWriteAccess(
          token,
          targetOwner,
          targetRepo,
          identity.username,
        );
      }
      sandboxToken = await getGithubRepositoryToken(project.repoOwner, project.repoName);
      pushSandboxToken = thread.githubPullRequestHeadRepository
        ? await getGithubRepositoryTokenForFullName(thread.githubPullRequestHeadRepository)
        : sandboxToken;
    } catch (error) {
      return failBeforeExecution(error, "validate");
    }
  }

  const persistedWorkspace = persistedThreadWorkspace(project, thread);
  const resolveWorkspace = () => persistedWorkspace
    ? Promise.resolve(persistedWorkspace)
    : convexAction(api.projectActions.resolveThreadWorkspace, {
        projectId: options.projectId,
        threadId: options.threadId,
      });
  let workspace: Awaited<ReturnType<typeof resolveWorkspace>>;
  try {
    workspace = await resolveWorkspace();
  } catch (error) {
    return failBeforeExecution(error, "branch");
  }
  const expectedBranch = workspace.featureBranch;
  const baseBranch = workspace.baseBranch;
  const fallbackTitle = thread.title && thread.title !== "New thread" ? thread.title : "Update project changes";

  const handlers: Record<GitWorkflowPhase, (checkpoint: GitWorkflowCheckpoint) => Promise<GitWorkflowPhaseOutput>> = {
    branch: async () => {
      const inspected = await inspectProjectSandboxGit({
        sandboxId,
        repoName: project.repoName,
        sandboxWorkDir: workspace.worktreePath,
      });
      if (!inspected.branch || inspected.branch !== expectedBranch) {
        throw new GitWorkflowPhaseError({
          code: "BRANCH_MISMATCH",
          message: `Expected thread branch ${expectedBranch}, found ${inspected.branch || "detached HEAD"}.`,
          retryable: false,
          recoveryAction: "Restore the thread workspace to its assigned branch.",
        });
      }
      if (
        needsPullRequest(options.input.action) &&
        workspace.workspaceMode === "checkout" &&
        inspected.branch === baseBranch
      ) {
        if (!sandboxToken) throw new GithubConnectionError("GitHub credentials are required to create a feature branch.");
        let commitMessage = operation.commitMessage;
        let preferredBranch: string;
        if (inspected.hasChanges) {
          const prepared = await prepareProjectSandboxCommit({
            sandboxId,
            repoName: project.repoName,
            sandboxWorkDir: workspace.worktreePath,
          });
          const generated = await generateCommitMetadata({
            request: options.request,
            projectId: options.projectId,
            threadId: options.threadId,
            branch: prepared.branch,
            status: prepared.status,
            diff: prepared.diff,
            fallbackTitle,
            includeBranch: true,
          });
          commitMessage ??= generated.commitMessage;
          preferredBranch = generated.branchName!;
        } else {
          preferredBranch = await generateBranchName({
            request: options.request,
            projectId: options.projectId,
            threadId: options.threadId,
            message: fallbackTitle,
          });
        }
        const created = await createProjectSandboxFeatureBranch({
          sandboxId,
          baseBranch,
          preferredBranch,
          githubToken: sandboxToken,
          repoName: project.repoName,
          sandboxWorkDir: workspace.worktreePath,
        });
        return {
          branch: created.branch,
          baseBranch,
          commitMessage,
          summary: `Created branch ${created.branch}`,
        };
      }
      return { branch: inspected.branch, baseBranch, summary: `Using branch ${inspected.branch}` };
    },
    validate: async (checkpoint) => {
      const inspected = await inspectProjectSandboxGit({
        sandboxId,
        repoName: project.repoName,
        sandboxWorkDir: workspace.worktreePath,
      });
      if (inspected.branch !== (checkpoint.branch ?? expectedBranch)) {
        throw new GitWorkflowPhaseError({ code: "BRANCH_CHANGED", message: "The thread branch changed during the operation." });
      }
      let diagnostics: string | undefined;
      let commitMessage = checkpoint.commitMessage ?? operation.commitMessage;
      if (needsCommit(options.input.action)) {
        if (!inspected.hasChanges) throw new SandboxNoChangesError("There are no workspace changes to commit.");
        const prepared = await prepareProjectSandboxCommit({
          sandboxId,
          repoName: project.repoName,
          sandboxWorkDir: workspace.worktreePath,
        });
        diagnostics = (await validatePreparedProjectSandboxCommit({
          sandboxId,
          repoName: project.repoName,
          sandboxWorkDir: workspace.worktreePath,
        })).diagnostics;
        commitMessage ??= await generateCommitMessage({
          request: options.request,
          projectId: options.projectId,
          threadId: options.threadId,
          branch: prepared.branch,
          status: prepared.status,
          diff: prepared.diff,
        });
      } else if (inspected.hasChanges) {
        throw new GitWorkflowPhaseError({
          code: "UNCOMMITTED_CHANGES",
          message: "This action requires a clean workspace.",
          retryable: false,
          recoveryAction: "Choose a commit-inclusive action or commit/stash the workspace changes.",
        });
      }
      return { commitMessage, diagnostics, summary: "Validation and Git checks passed" };
    },
    commit: async (checkpoint) => {
      const inspected = await inspectProjectSandboxGit({
        sandboxId,
        repoName: project.repoName,
        sandboxWorkDir: workspace.worktreePath,
      });
      const commitMessage = checkpoint.commitMessage ?? operation.commitMessage ?? fallbackTitle;
      let commitSha = inspected.commitSha;
      let diagnostics: string | undefined;
      let status: "succeeded" | "skipped" = "skipped";
      if (inspected.hasChanges) {
        const result = await commitPreparedProjectSandboxChanges({
          sandboxId,
          commitMessage,
          authorName: identity.name,
          authorEmail: identity.email,
          repoName: project.repoName,
          sandboxWorkDir: workspace.worktreePath,
        });
        commitSha = result.commitSha;
        diagnostics = result.diagnostics;
        status = "succeeded";
      }
      await convexMutation(api.threads.markChangesCommitted, {
        threadId: options.threadId,
        status: "committed",
        branch: checkpoint.branch ?? expectedBranch,
        commitSha,
        commitMessage,
      });
      return {
        status,
        branch: checkpoint.branch ?? expectedBranch,
        commitSha,
        commitMessage,
        diagnostics,
        summary: status === "skipped" ? `Reused commit ${commitSha.slice(0, 7)}` : `Committed files as ${commitSha.slice(0, 7)}`,
      };
    },
    push: async (checkpoint) => {
      if (!pushSandboxToken) throw new GithubConnectionError("GitHub credentials are required to push changes.");
      const pushResult = await pushProjectSandboxBranchIfNeeded({
        sandboxId,
        githubToken: pushSandboxToken,
        repoName: project.repoName,
        sandboxWorkDir: workspace.worktreePath,
        target: thread.githubPullRequestHeadCloneUrl && thread.githubPullRequestHeadBranch
          ? {
              remoteUrl: thread.githubPullRequestHeadCloneUrl,
              remoteBranch: thread.githubPullRequestHeadBranch,
              canPush: Boolean(thread.githubPullRequestHeadCanPush),
              isFork: Boolean(thread.githubPullRequestIsFork),
            }
          : undefined,
      });
      await convexMutation(api.threads.markChangesCommitted, {
        threadId: options.threadId,
        status: "pushed",
        branch: checkpoint.branch ?? expectedBranch,
        commitSha: pushResult.commitSha,
        commitMessage: checkpoint.commitMessage ?? operation.commitMessage ?? thread.commitMessage ?? "Push thread branch",
      });
      return {
        status: pushResult.alreadyPushed ? "skipped" : "succeeded",
        commitSha: pushResult.commitSha,
        pushResult,
        summary: pushResult.alreadyPushed
          ? `Commit ${pushResult.commitSha.slice(0, 7)} was already on GitHub`
          : `Pushed ${pushResult.commitSha.slice(0, 7)} to GitHub`,
      };
    },
    pull_request: async (checkpoint) => {
      if (!token || !sandboxToken) throw new GithubConnectionError("GitHub credentials are required to create a pull request.");
      const pullRequestContext = await readProjectSandboxPullRequestContext({
        sandboxId,
        baseBranch: checkpoint.baseBranch ?? baseBranch,
        githubToken: sandboxToken,
        repoName: project.repoName,
        sandboxWorkDir: workspace.worktreePath,
      });
      if (pullRequestContext.commitsAhead < 1) {
        throw new GitWorkflowPhaseError({
          code: "NO_BRANCH_COMMITS",
          message: `The thread branch does not differ from ${checkpoint.baseBranch ?? baseBranch}.`,
          retryable: false,
          recoveryAction: "Commit a change to the thread branch before creating a pull request.",
        });
      }
      const head = resolveGithubPullRequestHead({
        baseOwner: project.repoOwner,
        localBranch: checkpoint.branch ?? expectedBranch,
        importedHeadBranch: thread.githubPullRequestHeadBranch,
        importedHeadRepository: thread.githubPullRequestHeadRepository,
      });
      await convexMutation(api.threads.markPullRequestCreating, {
        threadId: options.threadId,
        branch: head.branch,
      });
      let pull: { number: number; htmlUrl: string } | undefined =
        thread.pullRequestNumber && thread.pullRequestUrl
          ? { number: thread.pullRequestNumber, htmlUrl: thread.pullRequestUrl }
          : await fetchGithubPullRequestForBranch(
              token,
              project.repoOwner,
              project.repoName,
              head.branch,
              {
                base: checkpoint.baseBranch ?? baseBranch,
                state: "open",
                headOwner: head.owner,
              },
            );
      let status: "succeeded" | "skipped" = "skipped";
      if (!pull) {
        const generated = operation.pullRequestTitle && operation.pullRequestBody
          ? undefined
          : await generatePullRequestContent({
              request: options.request,
              projectId: options.projectId,
              threadId: options.threadId,
              baseBranch: checkpoint.baseBranch ?? baseBranch,
              headBranch: head.reference,
              commitSummary: pullRequestContext.commitSummary,
              diffSummary: pullRequestContext.diffSummary,
              diffPatch: pullRequestContext.diffPatch,
              template: pullRequestContext.template,
            });
        try {
          pull = await createGithubPullRequest(token, project.repoOwner, project.repoName, {
            title: operation.pullRequestTitle ?? generated!.title,
            head: head.reference,
            base: checkpoint.baseBranch ?? baseBranch,
            body: operation.pullRequestBody ?? generated!.body,
            draft: operation.pullRequestDraft ?? false,
          });
          status = "succeeded";
        } catch (error) {
          pull = await fetchGithubPullRequestForBranch(
            token,
            project.repoOwner,
            project.repoName,
            head.branch,
            {
              base: checkpoint.baseBranch ?? baseBranch,
              state: "open",
              headOwner: head.owner,
            },
          );
          if (!pull) throw error;
        }
      }
      if (!pull) throw new Error("GitHub did not return the created pull request.");
      await convexMutation(api.threads.markPullRequestCreated, {
        threadId: options.threadId,
        branch: head.branch,
        url: pull.htmlUrl,
        number: pull.number,
      });
      return {
        status,
        pullRequestNumber: pull.number,
        pullRequestUrl: pull.htmlUrl,
        summary: status === "skipped" ? `Found existing pull request #${pull.number}` : `Created pull request #${pull.number}`,
      };
    },
  };

  try {
    await executeResumableGitWorkflow({
      action: operation.requestedAction,
      phaseResults: operation.phaseResults,
      checkpoint: {
        branch: operation.branch,
        baseBranch: operation.baseBranch,
        commitSha: operation.commitSha,
        commitMessage: operation.commitMessage,
        pushResult: operation.pushResult,
        pullRequestNumber: operation.pullRequestNumber,
        pullRequestUrl: operation.pullRequestUrl,
      },
      handlers: Object.fromEntries(Object.entries(handlers).map(([phase, handler]) => [
        phase,
        async (checkpoint: GitWorkflowCheckpoint) => {
          try {
            return await handler(checkpoint);
          } catch (error) {
            throw phaseError(error, phase as GitWorkflowPhase);
          }
        },
      ])) as typeof handlers,
      onPhaseStart: async (phase) => {
        await convexMutation(api.threads.startGitOperationPhase, {
          threadId: options.threadId,
          operationId: operation.operationId,
          phase,
        });
      },
      onPhaseComplete: async (result, checkpoint) => {
        await convexMutation(api.threads.completeGitOperationPhase, {
          threadId: options.threadId,
          operationId: operation.operationId,
          result,
          ...checkpoint,
        });
      },
      onPhaseFailure: async (result, failure) => {
        await convexMutation(api.threads.failGitOperation, {
          threadId: options.threadId,
          operationId: operation.operationId,
          result,
          failure,
        });
        if (failure.phase === "pull_request") {
          await convexMutation(api.threads.markPullRequestFailed, {
            threadId: options.threadId,
            error: failure.message,
          }).catch(() => undefined);
        }
      },
    });
    await convexMutation(api.threads.completeGitOperation, {
      threadId: options.threadId,
      operationId: operation.operationId,
    });
    const completed = await convexQuery(api.threads.getGitOperation, {
      threadId: options.threadId,
      operationId: operation.operationId,
    });
    if (!completed) throw new Error("The completed Git operation could not be loaded.");
    return Response.json(operationResponse(completed));
  } catch (error) {
    await releaseOperationLease().catch(() => undefined);
    const latest = await convexQuery(api.threads.getGitOperation, {
      threadId: options.threadId,
      operationId: operation.operationId,
    }).catch(() => null);
    const workflowError = error instanceof GitWorkflowPhaseError ? error : phaseError(error, operation.currentPhase ?? "branch");
    return Response.json({
      operationId: operation.operationId,
      status: "failed",
      error: {
        code: workflowError.code,
        message: workflowError.message,
        retryable: workflowError.retryable,
        recoveryAction: workflowError.recoveryAction,
        diagnostics: workflowError.diagnostics,
      },
      operation: latest ? operationResponse(latest) : undefined,
    }, { status: workflowError.code === "NO_CHANGES" || workflowError.code === "UNCOMMITTED_CHANGES" ? 409 : 500 });
  }
}
