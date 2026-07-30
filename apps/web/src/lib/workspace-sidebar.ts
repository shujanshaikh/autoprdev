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
): { active: T[]; settled: T[] } {
  const normalizedSearch = options.search.trim().toLocaleLowerCase();
  const visible = threads.filter((thread) => {
    if (options.projectId && thread.projectId !== options.projectId) return false;
    if (!normalizedSearch) return true;
    return `${thread.title ?? ""} ${thread.threadId}`
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });
  const active: T[] = [];
  const settled: T[] = [];

  for (const thread of visible) {
    (isSidebarThreadSettled(thread, options.now) ? settled : active).push(thread);
  }

  active.sort(
    (left, right) => right.createdAt - left.createdAt || left.threadId.localeCompare(right.threadId),
  );
  settled.sort(
    (left, right) => right.updatedAt - left.updatedAt || left.threadId.localeCompare(right.threadId),
  );
  return { active, settled };
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
