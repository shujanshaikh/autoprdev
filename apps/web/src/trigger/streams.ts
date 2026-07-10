import { streams } from "@trigger.dev/sdk";
import type { UIMessageChunk } from "ai";

import { AGENT_STREAM_ID } from "#/lib/trigger-agent-contract";

export const agentUIStream = streams.define<UIMessageChunk>({
  id: AGENT_STREAM_ID,
});
