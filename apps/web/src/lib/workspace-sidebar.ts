export const SIDEBAR_AUTO_SETTLE_DAYS = 3;
export const SETTLED_INITIAL_COUNT = 10;
export const SETTLED_PAGE_COUNT = 25;

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface SidebarThreadRecord {
  threadId: string;
  projectId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  isLive?: boolean;
  pinnedAt?: number;
  unreadAt?: number;
  snoozedUntil?: number;
  settledOverride?: "settled" | "active";
  settledAt?: number;
  githubPullRequestState?: "open" | "closed" | "merged";
}

export function isSidebarThreadSettled(
  thread: SidebarThreadRecord,
  now = Date.now(),
): boolean {
  if (thread.isLive) return false;
  if (thread.settledOverride === "settled") return true;
  if (thread.settledOverride === "active") return false;
  if (
    thread.githubPullRequestState === "closed" ||
    thread.githubPullRequestState === "merged"
  ) {
    return true;
  }

  return thread.updatedAt < now - SIDEBAR_AUTO_SETTLE_DAYS * DAY_MS;
}

export function partitionSidebarThreads<T extends SidebarThreadRecord>(
  threads: readonly T[],
  options: {
    projectId: string | null;
    search: string;
    now?: number;
  },
): { pinned: T[]; active: T[]; snoozed: T[]; settled: T[] } {
  const normalizedSearch = options.search.trim().toLocaleLowerCase();
  const visible = threads.filter((thread) => {
    if (options.projectId && thread.projectId !== options.projectId) return false;
    if (!normalizedSearch) return true;
    return `${thread.title ?? ""} ${thread.threadId}`
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });
  const active: T[] = [];
  const pinned: T[] = [];
  const snoozed: T[] = [];
  const settled: T[] = [];

  for (const thread of visible) {
    if (thread.snoozedUntil && thread.snoozedUntil > (options.now ?? Date.now())) {
      snoozed.push(thread);
    } else if (isSidebarThreadSettled(thread, options.now)) {
      settled.push(thread);
    } else if (thread.pinnedAt) {
      pinned.push(thread);
    } else {
      active.push(thread);
    }
  }

  pinned.sort(
    (left, right) => (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0)
      || right.createdAt - left.createdAt
      || left.threadId.localeCompare(right.threadId),
  );
  active.sort(
    (left, right) => right.createdAt - left.createdAt || left.threadId.localeCompare(right.threadId),
  );
  snoozed.sort(
    (left, right) => (left.snoozedUntil ?? 0) - (right.snoozedUntil ?? 0)
      || left.threadId.localeCompare(right.threadId),
  );
  settled.sort(
    (left, right) => right.updatedAt - left.updatedAt || left.threadId.localeCompare(right.threadId),
  );
  return { pinned, active, snoozed, settled };
}

export interface SnoozePreset {
  id: "hour" | "three-hours" | "evening" | "tomorrow" | "next-week";
  label: string;
  whenLabel: string;
  snoozedUntil: number;
}

const HOUR_MS = 60 * 60 * 1_000;

function atLocalHour(date: Date, hour: number) {
  const result = new Date(date);
  result.setHours(hour, 0, 0, 0);
  return result;
}

function addLocalDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatSnoozeTime(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The same practical wake-up choices used by T3 Code's thread menu. */
export function resolveSnoozePresets(now: Date): readonly SnoozePreset[] {
  const inAnHour = new Date(now.getTime() + HOUR_MS);
  const inThreeHours = new Date(now.getTime() + 3 * HOUR_MS);
  const presets: SnoozePreset[] = [
    {
      id: "hour",
      label: "In 1 hour",
      whenLabel: formatSnoozeTime(inAnHour),
      snoozedUntil: inAnHour.getTime(),
    },
    {
      id: "three-hours",
      label: "In 3 hours",
      whenLabel: formatSnoozeTime(inThreeHours),
      snoozedUntil: inThreeHours.getTime(),
    },
  ];

  const evening = atLocalHour(now, 18);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push({
      id: "evening",
      label: "This evening",
      whenLabel: formatSnoozeTime(evening),
      snoozedUntil: evening.getTime(),
    });
  }

  const tomorrow = atLocalHour(addLocalDays(now, 1), 9);
  presets.push({
    id: "tomorrow",
    label: "Tomorrow",
    whenLabel: formatSnoozeTime(tomorrow),
    snoozedUntil: tomorrow.getTime(),
  });

  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  const nextWeek = atLocalHour(addLocalDays(now, daysUntilMonday), 9);
  presets.push({
    id: "next-week",
    label: "Next week",
    whenLabel: `${nextWeek.toLocaleDateString(undefined, { weekday: "short" })} ${formatSnoozeTime(nextWeek)}`,
    snoozedUntil: nextWeek.getTime(),
  });

  return presets;
}

export function resolveNewThreadProjectId(
  projects: readonly { projectId: string }[],
  options: { activeProjectId?: string; scopedProjectId: string | null },
): string | null {
  if (
    options.scopedProjectId &&
    projects.some((project) => project.projectId === options.scopedProjectId)
  ) {
    return options.scopedProjectId;
  }
  if (
    options.activeProjectId &&
    projects.some((project) => project.projectId === options.activeProjectId)
  ) {
    return options.activeProjectId;
  }
  return projects[0]?.projectId ?? null;
}
