import { describe, expect, it } from "vitest";

import {
  partitionSidebarThreads,
  resolveSnoozePresets,
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

    expect(result.pinned).toEqual([]);
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

  it("keeps pins above regular threads and snoozed work ordered by wake time", () => {
    const result = partitionSidebarThreads(
      [
        thread({ threadId: "regular", createdAt: NOW - 100 }),
        thread({ threadId: "first-pin", pinnedAt: NOW - 20 }),
        thread({ threadId: "latest-pin", pinnedAt: NOW - 10 }),
        thread({ threadId: "sleeping", snoozedUntil: NOW + DAY_MS }),
        thread({ threadId: "waking-first", snoozedUntil: NOW + 1_000 }),
        thread({ threadId: "awake", snoozedUntil: NOW - 1, createdAt: NOW }),
      ],
      { projectId: null, search: "", now: NOW },
    );

    expect(result.pinned.map((item) => item.threadId)).toEqual(["latest-pin", "first-pin"]);
    expect(result.active.map((item) => item.threadId)).toEqual(["awake", "regular"]);
    expect(result.snoozed.map((item) => item.threadId)).toEqual(["waking-first", "sleeping"]);
  });
});

describe("thread snooze presets", () => {
  it("offers short, evening, tomorrow, and next-week wake times", () => {
    const now = new Date(2026, 3, 8, 10, 0, 0, 0);
    const presets = resolveSnoozePresets(now);

    expect(presets.map((preset) => preset.id)).toEqual([
      "hour",
      "three-hours",
      "evening",
      "tomorrow",
      "next-week",
    ]);
    expect(new Date(presets.find((preset) => preset.id === "tomorrow")!.snoozedUntil).getHours()).toBe(9);
    expect(new Date(presets.find((preset) => preset.id === "next-week")!.snoozedUntil).getDay()).toBe(1);
  });

  it("drops this evening when it is less than an hour away", () => {
    const presets = resolveSnoozePresets(new Date(2026, 3, 8, 17, 30, 0, 0));

    expect(presets.map((preset) => preset.id)).not.toContain("evening");
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
