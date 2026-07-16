import { type Infer, v } from "convex/values";

export const gitRemoteStatusValidator = v.union(
  v.literal("not_configured"),
  v.literal("not_requested"),
  v.literal("available"),
  v.literal("unavailable"),
);

export const gitStatusKindValidator = v.union(
  v.literal("not_repository"),
  v.literal("synchronized"),
  v.literal("uncommitted"),
  v.literal("ahead"),
  v.literal("behind"),
  v.literal("diverged"),
  v.literal("detached"),
  v.literal("no_upstream"),
  v.literal("no_remote"),
  v.literal("remote_unavailable"),
);

export const gitChangedFileValidator = v.object({
  path: v.string(),
  originalPath: v.optional(v.string()),
  indexStatus: v.string(),
  workingTreeStatus: v.string(),
  additions: v.optional(v.number()),
  deletions: v.optional(v.number()),
});

export const githubPullRequestSummaryValidator = v.object({
  number: v.number(),
  title: v.string(),
  url: v.string(),
  state: v.union(v.literal("open"), v.literal("closed"), v.literal("unknown")),
  draft: v.boolean(),
});

export const threadGitStatusValidator = v.object({
  isRepo: v.boolean(),
  currentBranch: v.optional(v.string()),
  detachedHead: v.boolean(),
  baseBranch: v.string(),
  hasWorkingTreeChanges: v.boolean(),
  changedFiles: v.array(gitChangedFileValidator),
  changedFilesTruncated: v.boolean(),
  hasRemote: v.boolean(),
  hasUpstream: v.boolean(),
  remoteStatus: gitRemoteStatusValidator,
  remoteError: v.optional(v.object({
    code: v.string(),
    message: v.string(),
  })),
  aheadCount: v.union(v.number(), v.null()),
  behindCount: v.union(v.number(), v.null()),
  aheadOfBaseCount: v.union(v.number(), v.null()),
  diverged: v.union(v.boolean(), v.null()),
  localHeadSha: v.optional(v.string()),
  remoteHeadSha: v.optional(v.string()),
  pullRequest: v.optional(githubPullRequestSummaryValidator),
  kind: gitStatusKindValidator,
  checkedAt: v.number(),
  remoteCheckedAt: v.optional(v.number()),
});

export type GitRemoteStatus = Infer<typeof gitRemoteStatusValidator>;
export type GitStatusKind = Infer<typeof gitStatusKindValidator>;
export type GitChangedFile = Infer<typeof gitChangedFileValidator>;
export type GithubPullRequestSummary = Infer<typeof githubPullRequestSummaryValidator>;
export type ThreadGitStatus = Infer<typeof threadGitStatusValidator>;

export interface ParsedGitStatus {
  currentBranch?: string;
  detachedHead: boolean;
  localHeadSha?: string;
  upstream?: string;
  aheadCount: number | null;
  behindCount: number | null;
  changedFiles: GitChangedFile[];
}

function fileStatuses(xy: string) {
  return {
    indexStatus: xy[0] === "." ? " " : (xy[0] ?? " "),
    workingTreeStatus: xy[1] === "." ? " " : (xy[1] ?? " "),
  };
}

/** Parses `git status --porcelain=v2 --branch -z` without losing spaces in paths. */
export function parseGitStatusPorcelainV2(output: string): ParsedGitStatus {
  const records = output.split("\0");
  const changedFiles: GitChangedFile[] = [];
  let currentBranch: string | undefined;
  let detachedHead = false;
  let localHeadSha: string | undefined;
  let upstream: string | undefined;
  let aheadCount: number | null = null;
  let behindCount: number | null = null;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    if (record.startsWith("# branch.oid ")) {
      const oid = record.slice("# branch.oid ".length).trim();
      localHeadSha = oid === "(initial)" ? undefined : oid;
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const head = record.slice("# branch.head ".length).trim();
      detachedHead = head === "(detached)";
      currentBranch = detachedHead ? undefined : head;
      continue;
    }
    if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice("# branch.upstream ".length).trim() || undefined;
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match) {
        aheadCount = Number(match[1]);
        behindCount = Number(match[2]);
      }
      continue;
    }

    if (record.startsWith("? ")) {
      changedFiles.push({
        path: record.slice(2),
        indexStatus: " ",
        workingTreeStatus: "?",
      });
      continue;
    }

    const ordinary = /^1 ([^ ]+) (?:[^ ]+ ){6}(.*)$/.exec(record);
    if (ordinary) {
      changedFiles.push({ path: ordinary[2], ...fileStatuses(ordinary[1]) });
      continue;
    }

    const renamed = /^2 ([^ ]+) (?:[^ ]+ ){7}(.*)$/.exec(record);
    if (renamed) {
      changedFiles.push({
        path: renamed[2],
        originalPath: records[index + 1] || undefined,
        ...fileStatuses(renamed[1]),
      });
      index += 1;
      continue;
    }

    const unmerged = /^u ([^ ]+) (?:[^ ]+ ){8}(.*)$/.exec(record);
    if (unmerged) {
      changedFiles.push({ path: unmerged[2], ...fileStatuses(unmerged[1]) });
    }
  }

  return {
    currentBranch,
    detachedHead,
    localHeadSha,
    upstream,
    aheadCount,
    behindCount,
    changedFiles,
  };
}

/** Parses `git diff --numstat HEAD --` and ignores binary-file markers. */
export function parseGitNumstat(output: string) {
  const stats = new Map<string, { additions: number; deletions: number }>();

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!match || match[1] === "-" || match[2] === "-") continue;
    stats.set(match[3], { additions: Number(match[1]), deletions: Number(match[2]) });
  }

  return stats;
}

export function attachGitNumstat(
  files: GitChangedFile[],
  stats: ReadonlyMap<string, { additions: number; deletions: number }>,
) {
  return files.map((file) => {
    const stat = stats.get(file.path);
    return stat ? { ...file, ...stat } : file;
  });
}

export function classifyGitStatus(status: Pick<
  ThreadGitStatus,
  | "isRepo"
  | "detachedHead"
  | "hasWorkingTreeChanges"
  | "hasRemote"
  | "hasUpstream"
  | "remoteStatus"
  | "aheadCount"
  | "behindCount"
>): GitStatusKind {
  if (!status.isRepo) return "not_repository";
  if (status.detachedHead) return "detached";
  if (!status.hasRemote) return "no_remote";
  if (status.remoteStatus === "unavailable") return "remote_unavailable";
  if (status.hasWorkingTreeChanges) return "uncommitted";
  if (!status.hasUpstream) return "no_upstream";

  const ahead = status.aheadCount ?? 0;
  const behind = status.behindCount ?? 0;
  if (ahead > 0 && behind > 0) return "diverged";
  if (ahead > 0) return "ahead";
  if (behind > 0) return "behind";
  return "synchronized";
}
