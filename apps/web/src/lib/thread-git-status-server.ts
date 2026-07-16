import "@tanstack/react-start/server-only";

import { createSandbox, type DaytonaSandbox } from "@autopr/agent/sandbox";
import {
  attachGitNumstat,
  classifyGitStatus,
  parseGitNumstat,
  parseGitStatusPorcelainV2,
  type GithubPullRequestSummary,
  type ThreadGitStatus,
} from "@autopr/backend/convex/lib/gitStatus";

type CommandResult = {
  exitCode: number;
  output: string;
};

const MAX_PERSISTED_CHANGED_FILES = 500;

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function commandOutput(value: unknown) {
  const result = record(value);
  const artifacts = record(result?.artifacts);
  const stdout = [result?.result, result?.stdout, artifacts?.stdout]
    .find((part): part is string => typeof part === "string" && part.length > 0);
  const stderr = typeof result?.stderr === "string" ? result.stderr : undefined;
  return [stdout, stderr].filter(Boolean).join("\n");
}

async function runGit(
  sandbox: DaytonaSandbox,
  worktreePath: string,
  args: string,
  options: { allowFailure?: boolean; env?: Record<string, string> } = {},
): Promise<CommandResult> {
  const result = await sandbox.process.executeCommand(
    `git ${args}`,
    worktreePath,
    options.env,
    120,
  );
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : 0;
  const output = commandOutput(result);

  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(output.trim() || "Sandbox Git command failed.");
  }

  return { exitCode, output };
}

export function createEphemeralGitAuthEnvironment(githubToken?: string) {
  const env: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
  };

  if (githubToken) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraHeader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${githubToken}`).toString("base64")}`;
  }

  return env;
}

function safeRemoteError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Could not refresh the Git remote.";
  return raw
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://")
    .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, "$1[redacted]")
    .slice(0, 500);
}

async function readPorcelainStatus(sandbox: DaytonaSandbox, worktreePath: string) {
  const result = await runGit(sandbox, worktreePath, "status --porcelain=v2 --branch -z --untracked-files=all");
  return parseGitStatusPorcelainV2(result.output);
}

async function optionalOutput(sandbox: DaytonaSandbox, worktreePath: string, args: string) {
  const result = await runGit(sandbox, worktreePath, args, { allowFailure: true });
  return result.exitCode === 0 ? result.output.trim() || undefined : undefined;
}

export interface ReadThreadGitStatusOptions {
  sandboxId: string;
  worktreePath: string;
  baseBranch: string;
  repositoryUrl: string;
  refreshRemote: boolean;
  githubToken?: string;
  pullRequest?: GithubPullRequestSummary;
}

/**
 * Reads one thread's authoritative worktree state. Authentication is injected
 * only into the fetch process environment and is never written to Git config.
 */
export async function readThreadGitStatus(options: ReadThreadGitStatusOptions): Promise<ThreadGitStatus> {
  const checkedAt = Date.now();
  const sandbox = await createSandbox({ sandboxId: options.sandboxId });
  const repoCheck = await runGit(sandbox, options.worktreePath, "rev-parse --is-inside-work-tree", {
    allowFailure: true,
  });

  if (repoCheck.exitCode !== 0 || repoCheck.output.trim() !== "true") {
    const status: ThreadGitStatus = {
      isRepo: false,
      detachedHead: false,
      baseBranch: options.baseBranch,
      hasWorkingTreeChanges: false,
      changedFiles: [],
      changedFilesTruncated: false,
      hasRemote: false,
      hasUpstream: false,
      remoteStatus: "not_configured",
      aheadCount: null,
      behindCount: null,
      aheadOfBaseCount: null,
      diverged: null,
      kind: "not_repository",
      checkedAt,
    };
    return status;
  }

  let [parsed, remotesOutput] = await Promise.all([
    readPorcelainStatus(sandbox, options.worktreePath),
    optionalOutput(sandbox, options.worktreePath, "remote"),
  ]);
  const remotes = remotesOutput?.split(/\r?\n/).map((remote) => remote.trim()).filter(Boolean) ?? [];
  const upstreamRemote = parsed.upstream?.split("/")[0];
  const remote = upstreamRemote && remotes.includes(upstreamRemote)
    ? upstreamRemote
    : remotes.includes("origin") ? "origin" : remotes[0];
  const hasRemote = Boolean(remote);
  let remoteStatus: ThreadGitStatus["remoteStatus"] = hasRemote ? "not_requested" : "not_configured";
  let remoteError: ThreadGitStatus["remoteError"];
  let remoteCheckedAt: number | undefined;

  if (remote && options.refreshRemote) {
    try {
      if (remote === "origin") {
        await runGit(
          sandbox,
          options.worktreePath,
          `remote set-url origin ${shellQuote(options.repositoryUrl)}`,
        );
      }
      await runGit(sandbox, options.worktreePath, `fetch --prune ${shellQuote(remote)}`, {
        env: createEphemeralGitAuthEnvironment(options.githubToken),
      });
      remoteStatus = "available";
      remoteCheckedAt = Date.now();
      parsed = await readPorcelainStatus(sandbox, options.worktreePath);
    } catch (error) {
      remoteStatus = "unavailable";
      remoteCheckedAt = Date.now();
      remoteError = {
        code: "GIT_REMOTE_FETCH_FAILED",
        message: safeRemoteError(error),
      };
    }
  }

  const numstat = await optionalOutput(sandbox, options.worktreePath, "diff --numstat HEAD --");
  const allChangedFiles = attachGitNumstat(parsed.changedFiles, parseGitNumstat(numstat ?? ""));
  const changedFiles = allChangedFiles.slice(0, MAX_PERSISTED_CHANGED_FILES);
  const hasUpstream = Boolean(parsed.upstream);
  const canUseRemoteRefs = remoteStatus !== "unavailable";
  const remoteHeadSha = hasUpstream && canUseRemoteRefs
    ? await optionalOutput(sandbox, options.worktreePath, "rev-parse --verify '@{upstream}'")
    : undefined;

  let aheadCount = parsed.aheadCount;
  let behindCount = parsed.behindCount;
  if (!hasUpstream || !canUseRemoteRefs) {
    aheadCount = null;
    behindCount = null;
  }

  const remoteBaseRef = remote ? `refs/remotes/${remote}/${options.baseBranch}` : undefined;
  const resolvedBaseRef = remoteBaseRef && canUseRemoteRefs && await optionalOutput(
    sandbox,
    options.worktreePath,
    `rev-parse --verify ${shellQuote(remoteBaseRef)}`,
  )
    ? remoteBaseRef
    : `refs/heads/${options.baseBranch}`;
  const aheadOfBaseRaw = remoteStatus === "unavailable"
    ? undefined
    : await optionalOutput(
        sandbox,
        options.worktreePath,
        `rev-list --count ${shellQuote(resolvedBaseRef)}..HEAD`,
      );
  const aheadOfBaseCount = aheadOfBaseRaw !== undefined && /^\d+$/.test(aheadOfBaseRaw)
    ? Number(aheadOfBaseRaw)
    : null;
  const diverged = aheadCount === null || behindCount === null
    ? null
    : aheadCount > 0 && behindCount > 0;

  const statusWithoutKind = {
    isRepo: true,
    currentBranch: parsed.currentBranch,
    detachedHead: parsed.detachedHead,
    baseBranch: options.baseBranch,
    hasWorkingTreeChanges: allChangedFiles.length > 0,
    changedFiles,
    changedFilesTruncated: allChangedFiles.length > changedFiles.length,
    hasRemote,
    hasUpstream,
    remoteStatus,
    remoteError,
    aheadCount,
    behindCount,
    aheadOfBaseCount,
    diverged,
    localHeadSha: parsed.localHeadSha,
    remoteHeadSha,
    pullRequest: options.pullRequest,
    checkedAt,
    remoteCheckedAt,
  } satisfies Omit<ThreadGitStatus, "kind">;

  return {
    ...statusWithoutKind,
    kind: classifyGitStatus(statusWithoutKind),
  };
}
