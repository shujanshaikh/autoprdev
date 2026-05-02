import { createSandbox, type DaytonaSandbox } from "@autopr/agent/sandbox";

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
