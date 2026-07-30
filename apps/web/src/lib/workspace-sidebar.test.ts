import { describe, expect, it } from "vitest";

import {
  partitionSidebarThreads,
  resolveNewThreadProjectId,
  SIDEBAR_AUTO_SETTLE_DAYS,
} from "./workspace-sidebar";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = 2_000_000_000_000;

function thread(
  overrides: Partial<Parameters<typeof partitionSidebarThreads>[0][number]> = {},
) {
  return {
    threadId: "thread-1",
    projectId: "project-1",
    title: "Fix sidebar",
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
    ...overrides,
  };
}

describe("workspace sidebar thread partition", () => {
  it("keeps live work active and auto-settles inactive history", () => {
    const result = partitionSidebarThreads(
      [
        thread({ threadId: "live", isLive: true, updatedAt: NOW - 10 * DAY_MS }),
        thread({
          threadId: "old",
          createdAt: NOW - 8 * DAY_MS,
          updatedAt: NOW - (SIDEBAR_AUTO_SETTLE_DAYS + 1) * DAY_MS,
        }),
      ],
      { projectId: null, search: "", now: NOW },
    );

    expect(result.active.map((item) => item.threadId)).toEqual(["live"]);
    expect(result.settled.map((item) => item.threadId)).toEqual(["old"]);
  });

  it("honors explicit settlement in both directions and settled pull requests", () => {
    const result = partitionSidebarThreads(
      [
        thread({ threadId: "settled", settledOverride: "settled" }),
        thread({
          threadId: "pinned-active",
          settledOverride: "active",
          updatedAt: NOW - 30 * DAY_MS,
        }),
        thread({ threadId: "merged", githubPullRequestState: "merged" }),
      ],
      { projectId: null, search: "", now: NOW },
    );

    expect(result.active.map((item) => item.threadId)).toEqual(["pinned-active"]);
    expect(result.settled.map((item) => item.threadId)).toEqual(["merged", "settled"]);
  });

  it("filters by project and search before partitioning", () => {
    const result = partitionSidebarThreads(
      [
        thread({ threadId: "match", title: "Invite flow" }),
        thread({ threadId: "other-project", projectId: "project-2", title: "Invite flow" }),
        thread({ threadId: "other-title", title: "Billing" }),
      ],
      { projectId: "project-1", search: "invite", now: NOW },
    );

    expect(result.active.map((item) => item.threadId)).toEqual(["match"]);
  });
});

describe("new thread project resolution", () => {
  const projects = [{ projectId: "latest" }, { projectId: "active" }];

  it("prefers the selected project scope, then the route project, then the first project", () => {
    expect(
      resolveNewThreadProjectId(projects, {
        activeProjectId: "active",
        scopedProjectId: "latest",
      }),
    ).toBe("latest");
    expect(
      resolveNewThreadProjectId(projects, {
        activeProjectId: "active",
        scopedProjectId: null,
      }),
    ).toBe("active");
    expect(resolveNewThreadProjectId(projects, { scopedProjectId: null })).toBe("latest");
  });
});
