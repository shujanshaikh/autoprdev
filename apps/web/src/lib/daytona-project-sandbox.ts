import "@tanstack/react-start/server-only";

import { createSandbox, deleteSandbox, type DaytonaSandbox } from "@autopr/agent/sandbox";

const DEFAULT_SANDBOX_WORKDIR = "/home/daytona";
const REPO_PATH = "repo";

export class SandboxGitConflictError extends Error {
  constructor(message = "Could not switch branches because the sandbox has uncommitted changes.") {
    super(message);
    this.name = "SandboxGitConflictError";
  }
}

function shellEscape(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandOutput(result: { stdout?: string; stderr?: string; output?: string }) {
  return [result.output, result.stdout, result.stderr].filter(Boolean).join("\n");
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
      const output = commandOutput(result);

      if (
        /local changes|would be overwritten|Please commit your changes|Your local changes/i.test(output)
      ) {
        throw new SandboxGitConflictError();
      }

      throw new Error(output || "Sandbox git command failed.");
    }

    return result;
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined);
  }
}

export async function createProjectSandbox(options: {
  authenticatedCloneUrl: string;
  branch: string;
}): Promise<{
  sandboxId: string;
  sandboxName?: string;
  sandboxSnapshot?: string;
  sandboxWorkDir: string;
}> {
  const sandbox = await createSandbox();
  const sandboxWorkDir = (await sandbox.getWorkDir()) ?? DEFAULT_SANDBOX_WORKDIR;
  const repoPath = `${sandboxWorkDir}/${REPO_PATH}`;

  await sandbox.git.clone(options.authenticatedCloneUrl, REPO_PATH, options.branch);

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
}): Promise<void> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const quotedBranch = shellEscape(options.branch);
  const quotedRepoPath = shellEscape(`${(await sandbox.getWorkDir()) ?? DEFAULT_SANDBOX_WORKDIR}/${REPO_PATH}`);

  await runSandboxCommand(
    sandbox,
    [
      `cd ${quotedRepoPath}`,
      "git fetch origin --prune",
      `git checkout ${quotedBranch}`,
      `git pull --ff-only origin ${quotedBranch}`,
    ].join(" && "),
  );
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
}): Promise<PreparedProjectSandboxCommit> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const quotedRepoPath = shellEscape(`${(await sandbox.getWorkDir()) ?? DEFAULT_SANDBOX_WORKDIR}/${REPO_PATH}`);

  const status = commandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git status --porcelain`),
  ).trim();

  if (!status) {
    throw new SandboxNoChangesError("There are no sandbox changes to commit.");
  }

  await sandbox.git.add(REPO_PATH, ["."]);

  const branch = commandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git branch --show-current`),
  ).trim();

  if (!branch) {
    throw new Error("The sandbox repository is not on a named branch.");
  }

  const diff = commandOutput(
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
  push?: boolean;
  githubUsername?: string;
  githubToken?: string;
}): Promise<{ branch: string; commitSha: string; pushed: boolean }> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const quotedRepoPath = shellEscape(`${(await sandbox.getWorkDir()) ?? DEFAULT_SANDBOX_WORKDIR}/${REPO_PATH}`);
  const branch = commandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git branch --show-current`),
  ).trim();

  if (!branch) {
    throw new Error("The sandbox repository is not on a named branch.");
  }

  const stagedDiff = commandOutput(
    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git diff --cached --name-only`),
  ).trim();

  if (!stagedDiff) {
    throw new SandboxNoChangesError("There are no staged sandbox changes to commit.");
  }

  const commit = await sandbox.git.commit(
    REPO_PATH,
    options.commitMessage,
    options.authorName,
    options.authorEmail,
  );

  if (options.push) {
    if (!options.githubUsername || !options.githubToken) {
      throw new Error("GitHub credentials are required to push changes.");
    }

    await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git config push.autoSetupRemote true`);
    await sandbox.git.push(REPO_PATH, options.githubUsername, options.githubToken);
  }

  return { branch, commitSha: commit.sha, pushed: Boolean(options.push) };
}

export async function commitAndPushProjectSandboxChanges(options: {
  sandboxId: string;
  githubToken: string;
  githubUsername: string;
  authorName: string;
  authorEmail: string;
  branch: string;
  baseBranch: string;
  commitMessage: string;
}): Promise<{ branch: string; commitSha: string }> {
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const quotedRepoPath = shellEscape(`${(await sandbox.getWorkDir()) ?? DEFAULT_SANDBOX_WORKDIR}/${REPO_PATH}`);
  const quotedBranch = shellEscape(options.branch);
  const quotedBaseBranch = shellEscape(options.baseBranch);

  const status = await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git status --porcelain`);
  if (!commandOutput(status).trim()) {
    throw new SandboxNoChangesError();
  }

  const commit = await runSandboxCommand(
    sandbox,
    [
      `cd ${quotedRepoPath}`,
      "git fetch origin --prune",
      `git checkout -B ${quotedBranch}`,
      "git config push.autoSetupRemote true",
    ].join(" && "),
  )
    .then(() => sandbox.git.add(REPO_PATH, ["."]))
    .then(() =>
      sandbox.git.commit(
        REPO_PATH,
        options.commitMessage,
        options.authorName,
        options.authorEmail,
      ),
    )
    .then(async (createdCommit) => {
      await sandbox.git.push(REPO_PATH, options.githubUsername, options.githubToken);
      return createdCommit;
    });

  await runSandboxCommand(sandbox, `cd ${quotedRepoPath} && git checkout ${quotedBaseBranch}`).catch(() => undefined);

  return { branch: options.branch, commitSha: commit.sha };
}
