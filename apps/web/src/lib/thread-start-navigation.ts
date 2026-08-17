import type { CodexReasoningEffort } from "#/lib/codex-models";
import type { AgentProvider } from "#/lib/agent-models";

type ThreadStartNavigationOptions = {
  projectId: string;
  threadId: string;
  prompt?: string;
  provider?: AgentProvider;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
};

export function buildThreadStartNavigation({
  projectId,
  threadId,
  prompt,
  provider,
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
      ...(() => {
  let optionalProperties;
  if (prompt) optionalProperties = { prompt };
  return optionalProperties;
})(),
      ...(() => {
  let optionalProperties;
  if (provider) optionalProperties = { provider };
  return optionalProperties;
})(),
      ...(() => {
  let optionalProperties;
  if (model) optionalProperties = { model };
  return optionalProperties;
})(),
      ...(() => {
  let optionalProperties;
  if (reasoningEffort) optionalProperties = { reasoningEffort };
  return optionalProperties;
})(),
    },
    // Keep one-time handoff data available to the route without exposing it
    // in the URL or navigating again after the first prompt is consumed.
    mask: {
      ...route,
      search: {},
    },
  };
}
