import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

type StreamStatus = "connecting" | "reconnecting" | "streaming";

type ConsumeAgentRunOptions = {
  runId: string;
  streamPath: string;
  fetchAuthenticated: (path: string, init: RequestInit) => Promise<Response>;
  signal: AbortSignal;
  initialMessage?: UIMessage;
  onMessage: (message: UIMessage) => void;
  onStatus: (status: StreamStatus) => void;
};

class AgentStreamResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AgentStreamResponseError";
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function wait(delay: number, signal: AbortSignal) {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function validatedChunkStream(
  responseBody: ReadableStream<Uint8Array>,
  onChunk: (chunk: UIMessageChunk) => void,
) {
  const parsed = parseJsonEventStream({
    stream: responseBody,
    schema: uiMessageChunkSchema,
  });
  const reader = parsed.getReader();

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      const result = await reader.read();
      if (result.done) {
        controller.close();
        return;
      }
      if (!result.value.success) {
        controller.error(result.value.error);
        return;
      }
      onChunk(result.value.value);
      controller.enqueue(result.value.value);
    },
    async cancel() {
      await reader.cancel();
    },
  });
}

/**
 * Consumes the same indexed Trigger.dev UI-message stream used by the web app.
 * The chunk cursor survives short disconnects, so an in-flight response can be
 * resumed without replaying or duplicating output.
 */
export async function consumeAgentRunStream({
  streamPath,
  fetchAuthenticated,
  signal,
  initialMessage,
  onMessage,
  onStatus,
}: ConsumeAgentRunOptions) {
  let chunkIndex = 0;
  let latestMessage = initialMessage;
  let finished = false;
  let consecutiveErrors = 0;

  while (!finished && !signal.aborted) {
    onStatus(chunkIndex === 0 && consecutiveErrors === 0 ? "connecting" : "reconnecting");
    try {
      const separator = streamPath.includes("?") ? "&" : "?";
      const response = await fetchAuthenticated(
        `${streamPath}${separator}startIndex=${chunkIndex}`,
        { method: "GET", headers: { Accept: "text/event-stream" }, signal },
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AgentStreamResponseError(
          response.status,
          `Could not read the agent response (${response.status})${body ? `: ${body}` : ""}`,
        );
      }
      if (!response.body) throw new Error("The agent response stream was empty.");

      let receivedChunk = false;
      const chunks = validatedChunkStream(response.body, (chunk) => {
        receivedChunk = true;
        chunkIndex += 1;
        if (chunk.type === "finish") finished = true;
      });
      onStatus("streaming");
      for await (const message of readUIMessageStream({
        message: latestMessage,
        stream: chunks,
        terminateOnError: true,
      })) {
        latestMessage = message;
        onMessage(message);
      }
      consecutiveErrors = 0;
      if (!receivedChunk && !finished) await wait(250, signal);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof AgentStreamResponseError && !isRetryableStatus(error.status)) {
        throw error;
      }
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) {
        throw new Error(
          error instanceof Error
            ? `The live response disconnected: ${error.message}`
            : "The live response disconnected.",
        );
      }
      await wait(Math.min(250 * 2 ** (consecutiveErrors - 1), 2_000), signal);
    }
  }

  return latestMessage;
}
