import type { CodexReasoningEffort } from "#/lib/codex-models";

type ThreadStartNavigationOptions = {
  projectId: string;
  threadId: string;
  prompt?: string;
  model?: string;
  reasoningEffort: CodexReasoningEffort;
};

export function buildThreadStartNavigation({
  projectId,
  threadId,
  prompt,
  model,
  reasoningEffort,
}: ThreadStartNavigationOptions) {
  const route = {
    to: "/project/$projectId/thread/$threadId" as const,
    params: { projectId, threadId },
  };

  return {
    ...route,
    search: {
      ...(prompt ? { prompt } : {}),
      ...(model ? { model } : {}),
      reasoningEffort,
    },
    // Keep one-time handoff data available to the route without exposing it
    // in the URL or navigating again after the first prompt is consumed.
    mask: {
      ...route,
      search: {},
    },
  };
}
