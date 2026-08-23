import { attachGitNumstat, classifyGitStatus, parseGitNumstat, parseGitStatusPorcelainV2, type ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import { describe, expect, it } from "vitest";

const oid = "1234567890abcdef1234567890abcdef12345678";

function porcelain(...records: string[]) {
  return `${records.join("\0")}\0`;
}

function status(overrides: Partial<ThreadGitStatus> = {}): ThreadGitStatus {
  return {
    isRepo: true,
    currentBranch: "autopr/fix-login",
    detachedHead: false,
    baseBranch: "main",
    hasWorkingTreeChanges: false,
    changedFiles: [],
    changedFilesTruncated: false,
    hasRemote: true,
    hasUpstream: true,
    remoteStatus: "available",
    aheadCount: 0,
    behindCount: 0,
    aheadOfBaseCount: 0,
    diverged: false,
    localHeadSha: oid,
    remoteHeadSha: oid,
    kind: "synchronized",
    checkedAt: 1,
    ...overrides,
  };
}

describe("Git porcelain parsing", () => {
  it("parses a clean synchronized branch", () => {
    const parsed = parseGitStatusPorcelainV2(porcelain(
      `# branch.oid ${oid}`,
      "# branch.head autopr/fix-login",
      "# branch.upstream origin/autopr/fix-login",
      "# branch.ab +0 -0",
    ));

    expect(parsed).toMatchObject({
      currentBranch: "autopr/fix-login",
      detachedHead: false,
      upstream: "origin/autopr/fix-login",
      aheadCount: 0,
      behindCount: 0,
      changedFiles: [],
    });
  });

  it("parses ahead, behind, and changed-file records with numstat", () => {
    const parsed = parseGitStatusPorcelainV2(porcelain(
      `# branch.oid ${oid}`,
      "# branch.head autopr/fix-login",
      "# branch.upstream origin/autopr/fix-login",
      "# branch.ab +2 -1",
      `1 .M N... 100644 100644 100644 ${oid} ${oid} src/login form.ts`,
      "? src/new-file.ts",
    ));
    const files = attachGitNumstat(parsed.changedFiles, parseGitNumstat(
      "12\t3\tsrc/login form.ts\n-\t-\tsrc/image.png",
    ));

    expect(parsed).toMatchObject({ aheadCount: 2, behindCount: 1 });
    expect(files).toEqual([
      {
        path: "src/login form.ts",
        indexStatus: " ",
        workingTreeStatus: "M",
        additions: 12,
        deletions: 3,
      },
      {
        path: "src/new-file.ts",
        indexStatus: " ",
        workingTreeStatus: "?",
      },
    ]);
  });

  it("parses detached HEAD", () => {
    expect(parseGitStatusPorcelainV2(porcelain(
      `# branch.oid ${oid}`,
      "# branch.head (detached)",
    ))).toMatchObject({
      currentBranch: undefined,
      detachedHead: true,
      localHeadSha: oid,
      aheadCount: null,
      behindCount: null,
    });
  });

  it("keeps ahead and behind unknown when there is no upstream", () => {
    expect(parseGitStatusPorcelainV2(porcelain(
      `# branch.oid ${oid}`,
      "# branch.head autopr/local-only",
    ))).toMatchObject({
      upstream: undefined,
      aheadCount: null,
      behindCount: null,
    });
  });
});

describe("Git status classification", () => {
  it.each([
    ["clean", status(), "synchronized"],
    ["ahead", status({ aheadCount: 2 }), "ahead"],
    ["behind", status({ behindCount: 3 }), "behind"],
    ["diverged", status({ aheadCount: 2, behindCount: 1, diverged: true }), "diverged"],
    ["uncommitted", status({ hasWorkingTreeChanges: true }), "uncommitted"],
    ["no upstream", status({ hasUpstream: false, aheadCount: null, behindCount: null }), "no_upstream"],
    ["no remote", status({ hasRemote: false, hasUpstream: false, remoteStatus: "not_configured" }), "no_remote"],
    ["detached HEAD", status({ currentBranch: undefined, detachedHead: true }), "detached"],
    [
      "fetch failure",
      status({
        remoteStatus: "unavailable",
        remoteError: { code: "GIT_REMOTE_FETCH_FAILED", message: "network down" },
        aheadCount: null,
        behindCount: null,
        diverged: null,
      }),
      "remote_unavailable",
    ],
  ] as const)("classifies %s", (_name, input, expected) => {
    expect(classifyGitStatus(input)).toBe(expected);
  });

  it("does not treat a fetch failure as clean", () => {
    const input = status({
      remoteStatus: "unavailable",
      aheadCount: null,
      behindCount: null,
      diverged: null,
    });

    expect(classifyGitStatus(input)).not.toBe("synchronized");
  });
});
