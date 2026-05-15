function getThreadTabsStorageKey(projectId: string) {
  return `autopr:project:${projectId}:thread-tabs`;
}

export function readStoredThreadTabs(projectId: string, fallbackThreadId: string) {
  if (typeof window === "undefined") {
    return [fallbackThreadId];
  }

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(getThreadTabsStorageKey(projectId)) ?? "[]");
    if (Array.isArray(parsed)) {
      const tabs = parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
      return tabs.includes(fallbackThreadId) ? tabs : [...tabs, fallbackThreadId];
    }
  } catch {
    // Ignore invalid stored tab state.
  }

  return [fallbackThreadId];
}

export function writeStoredThreadTabs(projectId: string, tabs: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(getThreadTabsStorageKey(projectId), JSON.stringify(tabs));
}

