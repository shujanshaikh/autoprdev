// @vitest-environment jsdom

import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ThreadGitStatusIndicator } from "./thread-git-status-indicator";

vi.mock("#/lib/thread-git-status-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("#/lib/thread-git-status-query")>(),
  useThreadGitStatusQuery: () => ({ isFetching: true, isError: false }),
}));

afterEach(cleanup);

it("updates the header when the branch is renamed before the Git refresh completes", () => {
  const persistedStatus: ThreadGitStatus = {
    isRepo: true,
    currentBranch: "autopr/new-thread-123",
    detachedHead: false,
    baseBranch: "main",
    hasWorkingTreeChanges: false,
    changedFiles: [],
    changedFilesTruncated: false,
    hasRemote: true,
    hasUpstream: false,
    remoteStatus: "available",
    aheadCount: null,
    behindCount: null,
    aheadOfBaseCount: 0,
    diverged: false,
    localHeadSha: "1234567890",
    kind: "no_upstream",
    checkedAt: 10,
  };
  const props = { projectId: "project", threadId: "thread", persistedStatus, enabled: true };
  const { rerender } = render(<ThreadGitStatusIndicator {...props} />);
  expect(screen.getByText("autopr/new-thread-123")).toBeTruthy();

  rerender(
    <ThreadGitStatusIndicator
      {...props}
      expectedBranch="autopr/improve-ui"
      invalidatedAt={11}
    />,
  );
  expect(screen.getByText("autopr/improve-ui")).toBeTruthy();
  expect(screen.queryByText("autopr/new-thread-123")).toBeNull();
});
