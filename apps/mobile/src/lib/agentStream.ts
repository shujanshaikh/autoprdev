import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from "ai";

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

class EmptyAgentStreamError extends Error {
  constructor() {
    super("The live response produced no output.");
    this.name = "EmptyAgentStreamError";
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

function iterableToReadableStream<T>(iterable: AsyncIterable<T>, signal: AbortSignal) {
  const iterator = iterable[Symbol.asyncIterator]();

  return new ReadableStream<T>({
    async pull(controller) {
      if (signal.aborted) {
        await iterator.return?.();
        controller.close();
        return;
      }

      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
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

  async function* chunks(): AsyncGenerator<UIMessageChunk> {
    while (!finished && !signal.aborted) {
      onStatus(chunkIndex === 0 && consecutiveErrors === 0 ? "connecting" : "reconnecting");
      try {
        const separator = streamPath.includes("?") ? "&" : "?";
        const response = await fetchAuthenticated(
          `${streamPath}${separator}startIndex=${chunkIndex}`,
          { method: "GET", headers: { Accept: "text/event-stream" }, signal },
        );
        if (!response.ok) {
          throw new AgentStreamResponseError(
            response.status,
            `Could not read the agent response (${response.status})`,
          );
        }
        if (!response.body) throw new Error("The agent response stream was empty.");

        let receivedChunk = false;
        const parsed = parseJsonEventStream({
          stream: response.body,
          schema: uiMessageChunkSchema,
        });
        const reader = parsed.getReader();
        onStatus("streaming");
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) break;
            if (!result.value.success) throw result.value.error;

            receivedChunk = true;
            // A disconnect after useful output is a new interruption, not
            // another strike against a run that is still making progress.
            consecutiveErrors = 0;
            chunkIndex += 1;
            if (result.value.value.type === "finish") finished = true;
            yield result.value.value;
            if (finished) break;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }

        if (!receivedChunk && !finished) {
          consecutiveErrors += 1;
          if (consecutiveErrors >= 5) throw new EmptyAgentStreamError();
          await wait(Math.min(250 * 2 ** (consecutiveErrors - 1), 2_000), signal);
        } else {
          consecutiveErrors = 0;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof EmptyAgentStreamError) throw error;
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
  }

  const messageStream = readUIMessageStream({
    message: latestMessage,
    stream: iterableToReadableStream(chunks(), signal),
    terminateOnError: true,
  });
  const reader = messageStream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      latestMessage = result.value;
      onMessage(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  return latestMessage;
}
