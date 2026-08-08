import "@tanstack/react-start/server-only";

import {
  createSandbox,
  deleteSandbox,
  DEFAULT_SANDBOX_WORKDIR,
  sandboxRepositoryDirectoryName,
  sandboxRepositoryPath,
  type DaytonaSandbox,
} from "@autopr/agent/sandbox";
import {
  autoprSandboxLabels,
  autoprSandboxName,
} from "@autopr/backend/convex/lib/sandboxIdentity";

import { runAuthenticatedSandboxCommand, withEphemeralGitAuth } from "#/lib/sandbox-git-auth";
import { redactGitDiagnostic } from "#/lib/git-diagnostics";
import {
  sandboxCommandOutput,
  sandboxCommandStdout,
} from "@autopr/backend/convex/lib/sandboxCommandOutput";
import {
  decideWorktreeProvision,
  parseGitRemoteHeadNames,
  parseGitWorktreeList,
  resolveAvailableThreadFeatureBranch,
} from "@autopr/backend/convex/lib/threadWorktree";

export class SandboxGitConflictError extends Error {
  constructor(message = "Could not switch branches because the sandbox has uncommitted changes.") {
    super(message);
    this.name = "SandboxGitConflictError";
  }
}

function shellEscape(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export class SandboxGitCommandError extends Error {
  readonly diagnostics?: string;

  constructor(message: string, diagnostics?: string) {
    super(message);
    this.name = "SandboxGitCommandError";
    this.diagnostics = diagnostics;
  }
}

async function runSandboxCommand(sandbox: DaytonaSandbox, command: string) {
  const sessionId = `project-git-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  await sandbox.process.createSession(sessionId);

  try {
    const result = await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command,
        suppressInputEcho: true,
      },
      120,
    );

    if (typeof result.exitCode === "number" && result.exitCode !== 0) {
      const output = sandboxCommandOutput(result);

      if (
        /local changes|would be overwritten|Please commit your changes|Your local changes|not possible to fast-forward|non-fast-forward/i.test(output)
      ) {
        throw new SandboxGitConflictError(
          /fast-forward/i.test(output)
            ? "The pull request branch has diverged. Resolve the merge conflicts or rebase manually before retrying."
            : undefined,
        );
      }

      throw new Error(output || "Sandbox git command failed.");
    }

    return result;
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined);
  }
}

async function resolveProjectRepoLocation(
  _sandbox: DaytonaSandbox,
  options: {
    repoName?: string;
    repoUrl?: string;
    sandboxWorkDir?: string;
  } = {},
) {
  const explicitRepoPath = options.sandboxWorkDir?.trim();

  if (explicitRepoPath) {
    return {
      repoPath: explicitRepoPath,
      repoGitPath: explicitRepoPath,
    };
  }

  const repoDir = sandboxRepositoryDirectoryName({
    repoName: options.repoName,
    repoUrl: options.repoUrl,
  });
  const repoPath = sandboxRepositoryPath(DEFAULT_SANDBOX_WORKDIR, repoDir);

  return {
    repoPath,
    repoGitPath: repoPath,
  };
}

export async function createProjectSandbox(options: {
  projectId: string;
  cloneUrl: string;
  githubToken: string;
  branch: string;
  repoName: string;
}): Promise<{
  sandboxId: string;
  sandboxName?: string;
  sandboxSnapshot?: string;
  sandboxWorkDir: string;
}> {
  const sandbox = await createSandbox({
    cacheKey: options.projectId,
    name: autoprSandboxName(options.projectId),
    labels: autoprSandboxLabels(options.projectId),
  });
  const repoDir = sandboxRepositoryDirectoryName({
    repoName: options.repoName,
    repoUrl: options.cloneUrl,
  });
  const repoPath = sandboxRepositoryPath(DEFAULT_SANDBOX_WORKDIR, repoDir);

  const clone = await runAuthenticatedSandboxCommand(
    sandbox,
    options.githubToken,
    `git clone --branch ${shellEscape(options.branch)} --single-branch -- ${shellEscape(options.cloneUrl)} ${shellEscape(repoPath)}`,
    DEFAULT_SANDBOX_WORKDIR,
  );
  if (typeof clone.exitCode === "number" && clone.exitCode !== 0) {
    throw new SandboxGitCommandError(
      "Could not clone the selected repository.",
      redactGitDiagnostic(sandboxCommandOutput(clone), [options.githubToken]),
    );
  }

  return {
    sandboxId: sandbox.id,
    sandboxName: sandbox.name,
    sandboxSnapshot: sandbox.snapshot,
    sandboxWorkDir: repoPath,
  };
}

export async function deleteProjectSandbox(sandboxId: string): Promise<void> {
  await deleteSandbox(sandboxId);
}

export async function switchProjectSandboxBranch(options: {
  sandboxId: string;
  branch: string;
  githubToken: string;
  repoName?: string;
  sandboxWorkDir?: string;
}): Promise<void> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const { repoPath } = await resolveProjectRepoLocation(sandbox, options);
  const quotedBranch = shellEscape(options.branch);
  const quotedRepoPath = shellEscape(repoPath);

  const fetchResult = await runAuthenticatedSandboxCommand(
    sandbox,
    options.githubToken,
    "git fetch origin --prune",
    repoPath,
  );
  if (typeof fetchResult.exitCode === "number" && fetchResult.exitCode !== 0) {
    throw new Error(fetchResult.stderr || fetchResult.result || "Could not fetch the selected branch.");
  }
  await runSandboxCommand(
    sandbox,
    `cd ${quotedRepoPath} && git checkout ${quotedBranch} && git merge --ff-only ${shellEscape(`origin/${options.branch}`)}`,
  );
}

export async function materializeGithubPullRequestWorktree(options: {
  sandboxId: string;
  repositoryPath: string;
  worktreePath: string;
  localBranch: string;
  pullRequestNumber: number;
  headCloneUrl: string;
  headBranch: string;
  expectedHeadSha: string;
  githubToken: string;
}): Promise<{ headSha: string; upstreamBranch: string }> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  return withEphemeralGitAuth(sandbox, options.githubToken, async (env) => {
    const runGit = async (cwd: string, args: string, allowFailure = false) => {
      const result = await sandbox.process.executeCommand(`git ${args}`, cwd, env, 120);
      const exitCode = typeof result.exitCode === "number" ? result.exitCode : 0;
      const output = sandboxCommandOutput({
        result: result.result,
        stderr: result.stderr,
      }).trim();
      if (!allowFailure && exitCode !== 0) {
        throw new SandboxGitCommandError(
          "Could not check out the pull request.",
          redactGitDiagnostic(output, [options.githubToken]),
        );
      }
      return { exitCode, output };
    };

    await runGit(options.repositoryPath, "worktree prune");
    const [list, branchCheck] = await Promise.all([
      runGit(options.repositoryPath, "worktree list --porcelain"),
      runGit(
        options.repositoryPath,
        `show-ref --verify --quiet ${shellEscape(`refs/heads/${options.localBranch}`)}`,
        true,
      ),
    ]);
    let decision = decideWorktreeProvision({
      entries: parseGitWorktreeList(list.output),
      desiredPath: options.worktreePath,
      featureBranch: options.localBranch,
      branchExists: branchCheck.exitCode === 0,
    });
    if (decision.kind === "conflict") {
      throw new SandboxGitConflictError(decision.message);
    }

    const remoteName = `autopr-pr-${options.pullRequestNumber}`;
    const remoteCheck = await runGit(
      options.repositoryPath,
      `remote get-url ${shellEscape(remoteName)}`,
      true,
    );
    await runGit(
      options.repositoryPath,
      remoteCheck.exitCode === 0
        ? `remote set-url ${shellEscape(remoteName)} ${shellEscape(options.headCloneUrl)}`
        : `remote add ${shellEscape(remoteName)} ${shellEscape(options.headCloneUrl)}`,
    );
    const remoteTrackingRef = `refs/remotes/${remoteName}/${options.headBranch}`;

    if (decision.kind === "create-branch-and-worktree") {
      await runGit(
        options.repositoryPath,
        `fetch --force ${shellEscape(remoteName)} ${shellEscape(`refs/heads/${options.headBranch}:${remoteTrackingRef}`)}`,
      );
      const fetched = await runGit(
        options.repositoryPath,
        `rev-parse ${shellEscape(remoteTrackingRef)}`,
      );
      if (fetched.output !== options.expectedHeadSha) {
        throw new SandboxGitCommandError(
          "The pull request branch moved while it was being opened. Resolve the PR again and retry.",
        );
      }
      await runGit(
        options.repositoryPath,
        `branch ${shellEscape(options.localBranch)} ${shellEscape(options.expectedHeadSha)}`,
      );
      decision = { kind: "create-from-existing-branch", path: options.worktreePath };
    }

    if (decision.kind === "create-from-existing-branch") {
      const parent = options.worktreePath.slice(0, options.worktreePath.lastIndexOf("/"));
      const pathCheck = await sandbox.process.executeCommand(
        `test -e ${shellEscape(options.worktreePath)}`,
        options.repositoryPath,
        undefined,
        30,
      );
      if (pathCheck.exitCode === 0) {
        throw new SandboxGitConflictError(
          `The thread worktree path already exists outside Git: ${options.worktreePath}`,
        );
      }
      const mkdir = await sandbox.process.executeCommand(
        `mkdir -p ${shellEscape(parent)}`,
        options.repositoryPath,
        undefined,
        30,
      );
      if (typeof mkdir.exitCode === "number" && mkdir.exitCode !== 0) {
        throw new SandboxGitCommandError("Could not create the thread worktree directory.");
      }
      await runGit(
        options.repositoryPath,
        `worktree add ${shellEscape(options.worktreePath)} ${shellEscape(options.localBranch)}`,
      );
    }

    // A retry may reuse a branch whose tracking ref was pruned. Refresh it before
    // restoring the upstream relationship, without resetting local work.
    await runGit(
      options.repositoryPath,
      `fetch --force ${shellEscape(remoteName)} ${shellEscape(`refs/heads/${options.headBranch}:${remoteTrackingRef}`)}`,
    );
    await runGit(
      options.repositoryPath,
      `branch --set-upstream-to=${shellEscape(`${remoteName}/${options.headBranch}`)} ${shellEscape(options.localBranch)}`,
    );
    const headSha = (await runGit(options.worktreePath, "rev-parse HEAD")).output;
    return { headSha, upstreamBranch: `${remoteName}/${options.headBranch}` };
  });
}

export class SandboxNoChangesError extends Error {
  constructor(message = "There are no sandbox changes to push.") {
    super(message);
    this.name = "SandboxNoChangesError";
  }
}

export interface PreparedProjectSandboxCommit {
  branch: string;
  status: string;
  diff: string;
}

export async function prepareProjectSandboxCommit(options: {
  sandboxId: string;
  repoName?: string;
  sandboxWorkDir?: string;
}): Promise<PreparedProjectSandboxCommit> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const { repoPath, repoGitPath } = await resolveProjectRepoLocation(sandbox, options);
  const quotedRepoPath = shellEscape(repoPath);

  const status = sandboxCommandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git status --porcelain`),
  ).trim();

  if (!status) {
    throw new SandboxNoChangesError("There are no sandbox changes to commit.");
  }

  await sandbox.git.add(repoGitPath, ["."]);

  const branch = sandboxCommandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git branch --show-current`),
  ).trim();

  if (!branch) {
    throw new Error("The sandbox repository is not on a named branch.");
  }

  const diff = sandboxCommandOutput(
    await runSandboxCommand(
      sandbox,
      [
        `cd ${quotedRepoPath}`,
        "git diff --cached --stat",
        "git diff --cached --no-ext-diff --unified=80",
      ].join(" && "),
    ),
  ).trim();

  return { branch, status, diff };
}

export async function commitPreparedProjectSandboxChanges(options: {
  sandboxId: string;
  commitMessage: string;
  authorName: string;
  authorEmail: string;
  repoName?: string;
  sandboxWorkDir?: string;
}): Promise<{ branch: string; commitSha: string; diagnostics?: string }> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const { repoPath } = await resolveProjectRepoLocation(sandbox, options);
  const quotedRepoPath = shellEscape(repoPath);
  const branch = sandboxCommandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git branch --show-current`),
  ).trim();

  if (!branch) {
    throw new Error("The sandbox repository is not on a named branch.");
  }

  const stagedDiff = sandboxCommandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git diff --cached --name-only`),
  ).trim();

  if (!stagedDiff) {
    throw new SandboxNoChangesError("There are no staged sandbox changes to commit.");
  }

  const commitResult = await sandbox.process.executeCommand(
    [
      "git",
      "-c", `user.name=${shellEscape(options.authorName)}`,
      "-c", `user.email=${shellEscape(options.authorEmail)}`,
      "commit", "-m", shellEscape(options.commitMessage),
    ].join(" "),
    repoPath,
    undefined,
    120,
  );
  const diagnostics = redactGitDiagnostic(sandboxCommandOutput({
    result: commitResult.result,
    stderr: commitResult.stderr,
  }));
  if (typeof commitResult.exitCode === "number" && commitResult.exitCode !== 0) {
    throw new SandboxGitCommandError("Git validation or commit hooks rejected the commit.", diagnostics);
  }
  const commitSha = sandboxCommandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git rev-parse HEAD`),
  ).trim();

  return { branch, commitSha, diagnostics: diagnostics || undefined };
}

export async function inspectProjectSandboxGit(options: {
  sandboxId: string;
  repoName?: string;
  sandboxWorkDir?: string;
}) {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const { repoPath } = await resolveProjectRepoLocation(sandbox, options);
  const quotedRepoPath = shellEscape(repoPath);
  const [branchResult, headResult, statusResult] = await Promise.all([
    runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git branch --show-current`),
    runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git rev-parse HEAD`),
    runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git status --porcelain`),
  ]);
  return {
    branch: sandboxCommandOutput(branchResult).trim(),
    commitSha: sandboxCommandOutput(headResult).trim(),
    hasChanges: Boolean(sandboxCommandOutput(statusResult).trim()),
  };
}

export async function createProjectSandboxFeatureBranch(options: {
  sandboxId: string;
  baseBranch: string;
  preferredBranch: string;
  githubToken: string;
  repoName?: string;
  sandboxWorkDir?: string;
}) {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const { repoPath } = await resolveProjectRepoLocation(sandbox, options);
  const quotedRepoPath = shellEscape(repoPath);
  const currentBranch = sandboxCommandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git branch --show-current`),
  ).trim();

  if (currentBranch !== options.baseBranch) {
    throw new SandboxGitConflictError(
      `The checkout moved from ${options.baseBranch} to ${currentBranch || "detached HEAD"} before the feature branch could be created.`,
    );
  }

  const existingBranches = sandboxCommandOutput(
    await runSandboxCommand(
      sandbox,
      `cd ${quotedRepoPath} && git for-each-ref --format='%(refname:short)' refs/heads`,
    ),
  ).split(/\r?\n/).map((branch) => branch.trim()).filter(Boolean);
  const remoteBranchesResult = await runAuthenticatedSandboxCommand(
    sandbox,
    options.githubToken,
    `git ls-remote --heads origin ${shellEscape(`refs/heads/${options.preferredBranch}*`)}`,
    repoPath,
  );
  if (typeof remoteBranchesResult.exitCode === "number" && remoteBranchesResult.exitCode !== 0) {
    throw new SandboxGitCommandError(
      "Could not inspect remote branches before creating the feature branch.",
      redactGitDiagnostic(sandboxCommandOutput(remoteBranchesResult), [options.githubToken]),
    );
  }
  existingBranches.push(...parseGitRemoteHeadNames(sandboxCommandStdout(remoteBranchesResult) ?? ""));
  const branch = resolveAvailableThreadFeatureBranch(options.preferredBranch, existingBranches);

  await runSandboxCommand(
    sandbox,
    `cd ${quotedRepoPath} && git check-ref-format --branch ${shellEscape(branch)} && git switch -c ${shellEscape(branch)}`,
  );

  return { branch };
}

export async function validatePreparedProjectSandboxCommit(options: {
  sandboxId: string;
  repoName?: string;
  sandboxWorkDir?: string;
}) {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const { repoPath } = await resolveProjectRepoLocation(sandbox, options);
  const result = await sandbox.process.executeCommand("git diff --cached --check", repoPath, undefined, 120);
  const diagnostics = redactGitDiagnostic(sandboxCommandOutput({ result: result.result, stderr: result.stderr }));
  if (typeof result.exitCode === "number" && result.exitCode !== 0) {
    throw new SandboxGitCommandError("Git validation found whitespace or conflict-marker errors.", diagnostics);
  }
  return { diagnostics: diagnostics || undefined };
}

async function inspectRemoteBranch(
  sandbox: DaytonaSandbox,
  repoPath: string,
  githubToken: string,
  target?: { remoteUrl: string; remoteBranch: string },
) {
  const quotedRepoPath = shellEscape(repoPath);
  const branch = sandboxCommandOutput(await runSandboxCommand(
    sandbox,
    `cd ${quotedRepoPath} && git branch --show-current`,
  )).trim();
  const commitSha = sandboxCommandOutput(await runSandboxCommand(
    sandbox,
    `cd ${quotedRepoPath} && git rev-parse HEAD`,
  )).trim();
  if (!branch) throw new Error("The sandbox repository is not on a named branch.");
  const remote = await runAuthenticatedSandboxCommand(
    sandbox,
    githubToken,
    `git ls-remote --heads ${shellEscape(target?.remoteUrl ?? "origin")} ${shellEscape(`refs/heads/${target?.remoteBranch ?? branch}`)}`,
    repoPath,
  );
  if (typeof remote.exitCode === "number" && remote.exitCode !== 0) {
    throw new SandboxGitCommandError(
      "Could not inspect the remote branch.",
      redactGitDiagnostic(sandboxCommandOutput({ result: remote.result, stderr: remote.stderr }), [githubToken]),
    );
  }
  return {
    branch,
    commitSha,
    remoteSha: sandboxCommandStdout(remote)?.trim().split(/\s+/)[0] || undefined,
  };
}

export async function pushProjectSandboxBranchIfNeeded(options: {
  sandboxId: string;
  githubToken: string;
  repoName?: string;
  sandboxWorkDir?: string;
  target?: { remoteUrl: string; remoteBranch: string; canPush: boolean; isFork: boolean };
}) {
  if (options.target && !options.target.canPush) {
    throw new SandboxGitCommandError(
      options.target.isFork
        ? "Your GitHub account cannot push to this fork's pull request branch. Ask the PR author for access or work locally without pushing."
      : "Your GitHub account cannot push to this pull request branch.",
    );
  }
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const { repoPath } = await resolveProjectRepoLocation(sandbox, options);
  const { branch, commitSha, remoteSha } = await inspectRemoteBranch(
    sandbox,
    repoPath,
    options.githubToken,
    options.target,
  );
  if (remoteSha === commitSha) {
    return { commitSha, remoteSha, pushed: false, alreadyPushed: true };
  }
  try {
    const remote = options.target?.remoteUrl ?? "origin";
    const remoteBranch = options.target?.remoteBranch ?? branch;
    const setUpstream = options.target ? "" : "--set-upstream ";
    const result = await runAuthenticatedSandboxCommand(
      sandbox,
      options.githubToken,
      `git push ${setUpstream}${shellEscape(remote)} ${shellEscape(`HEAD:refs/heads/${remoteBranch}`)}`,
      repoPath,
    );
    if (typeof result.exitCode === "number" && result.exitCode !== 0) {
      throw new Error(sandboxCommandOutput(result) || "Could not push the thread branch.");
    }
  } catch (error) {
    const diagnostics = redactGitDiagnostic(error instanceof Error ? error.message : String(error), [options.githubToken]);
    throw new SandboxGitCommandError("Could not push the thread branch.", diagnostics);
  }
  const pushedState = await inspectRemoteBranch(
    sandbox,
    repoPath,
    options.githubToken,
    options.target,
  );
  if (pushedState.remoteSha !== commitSha) {
    throw new SandboxGitCommandError(
      "Git did not publish the expected thread commit.",
      `Expected ${commitSha}, found ${pushedState.remoteSha ?? "no remote branch"}.`,
    );
  }
  return { commitSha, remoteSha: pushedState.remoteSha, pushed: true, alreadyPushed: false };
}

export interface ProjectSandboxPullRequestContext {
  commitsAhead: number;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  template?: string;
}

export async function readProjectSandboxPullRequestContext(options: {
  sandboxId: string;
  baseBranch: string;
  githubToken: string;
  repoName?: string;
  sandboxWorkDir?: string;
}): Promise<ProjectSandboxPullRequestContext> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const { repoPath } = await resolveProjectRepoLocation(sandbox, options);
  const remoteBase = `refs/remotes/origin/${options.baseBranch}`;
  const fetchBase = await runAuthenticatedSandboxCommand(
    sandbox,
    options.githubToken,
    `git fetch --no-tags origin ${shellEscape(`refs/heads/${options.baseBranch}:${remoteBase}`)}`,
    repoPath,
  );
  if (typeof fetchBase.exitCode === "number" && fetchBase.exitCode !== 0) {
    throw new SandboxGitCommandError(
      `Could not refresh the base branch ${options.baseBranch}.`,
      redactGitDiagnostic(sandboxCommandOutput(fetchBase), [options.githubToken]),
    );
  }
  const quotedRepoPath = shellEscape(repoPath);
  const quotedRange = shellEscape(`${remoteBase}..HEAD`);
  const quotedMergeRange = shellEscape(`${remoteBase}...HEAD`);
  const [countResult, commitsResult, statResult, patchResult, templateResult] = await Promise.all([
    runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git rev-list --count ${quotedRange}`),
    runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git log --format='%h %s' ${quotedRange}`),
    runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git diff --stat ${quotedMergeRange}`),
    runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git diff --no-ext-diff --unified=40 ${quotedMergeRange}`),
    runSandboxCommand(
      sandbox,
      [
        `cd ${quotedRepoPath}`,
        "for path in .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md pull_request_template.md PULL_REQUEST_TEMPLATE.md docs/pull_request_template.md; do",
        "  if [ -f \"$path\" ]; then head -c 40000 \"$path\"; break; fi",
        "done",
      ].join("\n"),
    ),
  ]);
  const commitsAhead = Number(sandboxCommandOutput(countResult).trim());
  if (!Number.isFinite(commitsAhead)) {
    throw new Error("Could not compare the thread branch with its base branch.");
  }
  const template = sandboxCommandOutput(templateResult).trim();
  return {
    commitsAhead,
    commitSummary: sandboxCommandOutput(commitsResult).trim(),
    diffSummary: sandboxCommandOutput(statResult).trim(),
    diffPatch: sandboxCommandOutput(patchResult).trim(),
    template: template || undefined,
  };
}

export async function pullProjectSandboxBranch(options: {
  sandboxId: string;
  branch: string;
  githubToken: string;
  repoName?: string;
  sandboxWorkDir?: string;
  target?: { remoteUrl: string; remoteBranch: string };
}): Promise<{ branch: string; commitSha: string }> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const { repoPath } = await resolveProjectRepoLocation(sandbox, options);
  const quotedRepoPath = shellEscape(repoPath);
  const currentBranch = sandboxCommandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git branch --show-current`),
  ).trim();

  if (currentBranch !== options.branch) {
    throw new Error(
      `Thread worktree branch mismatch: expected ${options.branch}, found ${currentBranch || "detached HEAD"}.`,
    );
  }

  const fetchResult = await runAuthenticatedSandboxCommand(
    sandbox,
    options.githubToken,
    options.target
      ? `git fetch ${shellEscape(options.target.remoteUrl)} ${shellEscape(`refs/heads/${options.target.remoteBranch}`)}`
      : "git fetch origin --prune",
    repoPath,
  );
  if (typeof fetchResult.exitCode === "number" && fetchResult.exitCode !== 0) {
    throw new Error(fetchResult.stderr || fetchResult.result || "Could not fetch the thread branch.");
  }

  await runSandboxCommand(
    sandbox,
    `cd ${quotedRepoPath} && git merge --ff-only ${shellEscape(options.target ? "FETCH_HEAD" : "@{upstream}")}`,
  );
  const commitSha = sandboxCommandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git rev-parse HEAD`),
  ).trim();

  return { branch: currentBranch, commitSha };
}
