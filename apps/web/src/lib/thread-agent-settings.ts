import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import type { AgentChatClientInput } from "./trigger-agent-contract";

/** Explicit turn choices win; omitted choices use the thread's saved defaults. */
export function resolveThreadModelRequest(
  thread: Pick<Doc<"threads">, "agentProvider" | "agentModel" | "agentReasoningEffort">,
  requested: AgentChatClientInput,
) {
  const changedModel = (requested.provider !== undefined && requested.provider !== thread.agentProvider)
    || (requested.model !== undefined && requested.model !== thread.agentModel);
  return {
    provider: requested.provider ?? thread.agentProvider,
    model: requested.model ?? (changedModel ? undefined : thread.agentModel),
    reasoningEffort: requested.reasoningEffort ?? (changedModel ? undefined : thread.agentReasoningEffort),
  };
}
