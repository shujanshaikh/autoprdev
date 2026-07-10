import {
  parseJsonEventStream,
  uiMessageChunkSchema,
  type ChatRequestOptions,
  type ChatTransport,
  type PrepareReconnectToStreamRequest,
  type PrepareSendMessagesRequest,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

interface SendMessagesOptions<UI_MESSAGE extends UIMessage> {
  trigger: "submit-message" | "regenerate-message";
  chatId: string;
  messageId?: string;
  messages: UI_MESSAGE[];
  abortSignal?: AbortSignal;
}

interface ReconnectToStreamOptions {
  chatId: string;
  abortSignal?: AbortSignal;
  startIndex?: number;
}

interface TriggerChatTransportOptions<UI_MESSAGE extends UIMessage> {
  api: string;
  fetch?: typeof fetch;
  onChatSendMessage?: (
    response: Response,
    options: SendMessagesOptions<UI_MESSAGE>,
  ) => void | Promise<void>;
  onChatEnd?: (options: { chatId: string; chunkIndex: number }) => void | Promise<void>;
  maxConsecutiveErrors?: number;
  reconnectDelayInMs?: number;
  prepareSendMessagesRequest?: PrepareSendMessagesRequest<UI_MESSAGE>;
  prepareReconnectToStreamRequest?: PrepareReconnectToStreamRequest;
}

class AgentStreamResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AgentStreamResponseError";
  }
}

function iterableToReadableStream<T>(
  iterable: AsyncIterable<T>,
  signal: AbortSignal | undefined,
): ReadableStream<T> {
  const iterator = iterable[Symbol.asyncIterator]();

  return new ReadableStream<T>({
    async pull(controller) {
      if (signal?.aborted) {
        await iterator.return?.();
        controller.close();
        return;
      }

      try {
        const result = await iterator.next();
        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableStreamResponseStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function waitForReconnect(delayInMs: number, signal: AbortSignal | undefined) {
  if (delayInMs <= 0 || signal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, delayInMs);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * AI SDK chat transport backed by Trigger.dev realtime streams.
 *
 * The POST only creates a task run and returns its ID. All assistant chunks
 * are consumed from the indexed GET stream, including the first connection,
 * so Vercel never owns the long-running agent request.
 */
export class TriggerChatTransport<UI_MESSAGE extends UIMessage>
  implements ChatTransport<UI_MESSAGE>
{
  private readonly fetch: typeof fetch;
  private readonly maxConsecutiveErrors: number;
  private readonly reconnectDelayInMs: number;

  constructor(private readonly options: TriggerChatTransportOptions<UI_MESSAGE>) {
    this.fetch = options.fetch ?? fetch.bind(globalThis);
    this.maxConsecutiveErrors = Math.max(1, Math.floor(options.maxConsecutiveErrors ?? 3));
    this.reconnectDelayInMs = Math.max(0, options.reconnectDelayInMs ?? 250);
  }

  async sendMessages(
    options: SendMessagesOptions<UI_MESSAGE> & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk>> {
    return iterableToReadableStream(this.sendMessagesIterator(options), options.abortSignal);
  }

  private async *sendMessagesIterator(
    options: SendMessagesOptions<UI_MESSAGE> & ChatRequestOptions,
  ): AsyncGenerator<UIMessageChunk> {
    const requestConfig = this.options.prepareSendMessagesRequest
      ? await this.options.prepareSendMessagesRequest({
          id: options.chatId,
          messages: options.messages,
          requestMetadata: options.metadata,
          body: options.body,
          credentials: undefined,
          headers: options.headers,
          api: this.options.api,
          trigger: options.trigger,
          messageId: options.messageId,
        })
      : undefined;
    const response = await this.fetch(requestConfig?.api ?? this.options.api, {
      method: "POST",
      body: JSON.stringify(requestConfig?.body ?? { messages: options.messages, ...options.body }),
      headers: requestConfig?.headers,
      credentials: requestConfig?.credentials,
      signal: options.abortSignal,
    });

    if (!response.ok) {
      throw new Error(`Failed to start agent: ${response.status} ${await response.text()}`);
    }

    const runId = response.headers.get("x-trigger-run-id");
    if (!runId) {
      throw new Error('Trigger.dev run ID not found in the "x-trigger-run-id" response header');
    }

    await this.options.onChatSendMessage?.(response, options);
    yield* this.reconnectToStreamIterator(options, runId);
  }

  async reconnectToStream(
    options: ReconnectToStreamOptions & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return iterableToReadableStream(this.reconnectToStreamIterator(options), options.abortSignal);
  }

  private async *reconnectToStreamIterator(
    options: ReconnectToStreamOptions & ChatRequestOptions,
    runId?: string,
  ): AsyncGenerator<UIMessageChunk> {
    let chunkIndex = Math.max(0, options.startIndex ?? 0);
    const defaultApi = `${this.options.api}/${encodeURIComponent(runId ?? options.chatId)}/stream`;
    const requestConfig = this.options.prepareReconnectToStreamRequest
      ? await this.options.prepareReconnectToStreamRequest({
          id: options.chatId,
          requestMetadata: options.metadata,
          body: undefined,
          credentials: undefined,
          headers: undefined,
          api: defaultApi,
        })
      : undefined;
    const baseUrl = requestConfig?.api ?? defaultApi;
    let gotFinish = false;
    let consecutiveErrors = 0;

    while (!gotFinish && !options.abortSignal?.aborted) {
      const url = new URL(baseUrl, globalThis.location?.origin ?? "http://localhost");
      url.searchParams.set("startIndex", String(chunkIndex));

      try {
        let receivedChunk = false;
        const response = await this.fetch(url, {
          headers: requestConfig?.headers,
          credentials: requestConfig?.credentials,
          signal: options.abortSignal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new AgentStreamResponseError(
            response.status,
            `Failed to reconnect to agent: ${response.status} ${body}`.trimEnd(),
          );
        }

        if (!response.body) {
          throw new Error("Failed to reconnect to agent: response body was empty");
        }

        const chunks = parseJsonEventStream({
          stream: response.body,
          schema: uiMessageChunkSchema,
        });

        // WebKit did not expose ReadableStream as an async iterable for a
        // number of iOS releases. The reader API is the cross-browser stream
        // primitive, so mobile clients can attach to an active run reliably.
        const reader = chunks.getReader();
        try {
          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) {
              break;
            }

            if (!chunk.success) {
              throw chunk.error;
            }

            receivedChunk = true;
            consecutiveErrors = 0;
            chunkIndex += 1;
            yield chunk.value;
            if (chunk.value.type === "finish") {
              gotFinish = true;
            }
          }
        } finally {
          reader.releaseLock();
        }

        consecutiveErrors = 0;
        if (!receivedChunk && !gotFinish) {
          await waitForReconnect(this.reconnectDelayInMs, options.abortSignal);
        }
      } catch (error) {
        if (options.abortSignal?.aborted) {
          return;
        }

        if (
          error instanceof AgentStreamResponseError &&
          !isRetryableStreamResponseStatus(error.status)
        ) {
          throw error;
        }

        consecutiveErrors += 1;
        console.error("Failed to read Trigger.dev agent stream", error);
        if (consecutiveErrors >= this.maxConsecutiveErrors) {
          throw new Error(
            `Failed to reconnect after ${this.maxConsecutiveErrors} consecutive errors. Last error: ${errorMessage(error)}`,
          );
        }

        await waitForReconnect(
          Math.min(this.reconnectDelayInMs * 2 ** (consecutiveErrors - 1), 2_000),
          options.abortSignal,
        );
      }
    }

    if (gotFinish) {
      await this.options.onChatEnd?.({ chatId: options.chatId, chunkIndex });
    }
  }
}
