import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

type SendOptions<UI_MESSAGE extends UIMessage> = Parameters<
  ChatTransport<UI_MESSAGE>["sendMessages"]
>[0];
type ReconnectOptions<UI_MESSAGE extends UIMessage> = Parameters<
  ChatTransport<UI_MESSAGE>["reconnectToStream"]
>[0];

interface TriggerSessionState {
  isStreaming?: boolean;
}

interface TriggerSessionTransport<UI_MESSAGE extends UIMessage>
  extends ChatTransport<UI_MESSAGE> {
  getSession(chatId: string): TriggerSessionState | undefined;
}

interface ResilientTriggerSessionTransportOptions {
  maxConsecutiveReconnects?: number;
  reconnectDelayInMs?: number;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isRetryableTriggerSessionStreamError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return false;
  }

  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status === 408 || status === 425 || status === 429 || status >= 500;
    }
  }

  return error instanceof TypeError || /fetch|network|socket|timeout|timed out|connection|econn|terminated/i.test(
    errorMessage(error),
  );
}

async function waitForReconnect(delayInMs: number, signal?: AbortSignal) {
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

function iterableToReadableStream<T>(iterable: AsyncIterable<T>) {
  const iterator = iterable[Symbol.asyncIterator]();

  return new ReadableStream<T>({
    async pull(controller) {
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
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

/**
 * Keeps Trigger session reconnects inside one AI SDK response stream.
 *
 * AI SDK's stream parser keeps active text/reasoning/tool part IDs only for
 * the lifetime of a single response stream. Letting a transient SSE failure
 * escape and then calling `resumeStream()` would create a fresh parser while
 * Trigger resumes after the earlier `text-start`, making the next delta
 * invalid. This adapter reconnects underneath that parser instead.
 */
export class ResilientTriggerSessionTransport<UI_MESSAGE extends UIMessage>
  implements ChatTransport<UI_MESSAGE>
{
  private readonly maxConsecutiveReconnects: number;
  private readonly reconnectDelayInMs: number;

  constructor(
    private readonly transport: TriggerSessionTransport<UI_MESSAGE>,
    options: ResilientTriggerSessionTransportOptions = {},
  ) {
    this.maxConsecutiveReconnects = Math.max(
      1,
      Math.floor(options.maxConsecutiveReconnects ?? 6),
    );
    this.reconnectDelayInMs = Math.max(0, options.reconnectDelayInMs ?? 250);
  }

  sendMessages = async (options: SendOptions<UI_MESSAGE>) => {
    const stream = await this.transport.sendMessages(options);
    return this.keepStreamConnected(stream, options);
  };

  reconnectToStream = async (options: ReconnectOptions<UI_MESSAGE>) => {
    const stream = await this.transport.reconnectToStream(options);
    return stream ? this.keepStreamConnected(stream, options) : null;
  };

  private keepStreamConnected(
    initialStream: ReadableStream<UIMessageChunk>,
    options: ReconnectOptions<UI_MESSAGE> & { abortSignal?: AbortSignal },
  ) {
    const transport = this.transport;
    const maxConsecutiveReconnects = this.maxConsecutiveReconnects;
    const reconnectDelayInMs = this.reconnectDelayInMs;

    async function* chunks(): AsyncGenerator<UIMessageChunk> {
      let stream: ReadableStream<UIMessageChunk> | null = initialStream;
      let consecutiveReconnects = 0;
      let lastError: unknown;

      while (!options.abortSignal?.aborted) {
        if (stream) {
          const reader = stream.getReader();
          let endedNormally = false;

          try {
            while (!options.abortSignal?.aborted) {
              const result = await reader.read();
              if (result.done) {
                endedNormally = true;
                break;
              }

              consecutiveReconnects = 0;
              yield result.value;
            }
          } catch (error) {
            lastError = error;
          } finally {
            if (options.abortSignal?.aborted) {
              await reader.cancel().catch(() => undefined);
            }
            reader.releaseLock();
          }

          if (options.abortSignal?.aborted) {
            return;
          }

          if (endedNormally && transport.getSession(options.chatId)?.isStreaming !== true) {
            return;
          }

          if (endedNormally) {
            lastError = new TypeError("Trigger session stream closed before the turn completed");
          }
          stream = null;
        }

        if (!isRetryableTriggerSessionStreamError(lastError)) {
          throw lastError;
        }

        consecutiveReconnects += 1;
        if (consecutiveReconnects > maxConsecutiveReconnects) {
          throw new Error(
            `Failed to reconnect to the Trigger session after ${maxConsecutiveReconnects} attempts. Last error: ${errorMessage(lastError)}`,
            { cause: lastError },
          );
        }

        await waitForReconnect(
          Math.min(reconnectDelayInMs * 2 ** (consecutiveReconnects - 1), 5_000),
          options.abortSignal,
        );
        if (options.abortSignal?.aborted) {
          return;
        }

        try {
          stream = await transport.reconnectToStream({
            chatId: options.chatId,
            headers: options.headers,
            body: options.body,
            metadata: options.metadata,
            abortSignal: options.abortSignal,
          } as ReconnectOptions<UI_MESSAGE>);

          if (!stream && transport.getSession(options.chatId)?.isStreaming !== true) {
            return;
          }

          if (!stream) {
            lastError = new TypeError("Trigger session stream is not ready to reconnect");
          }
        } catch (error) {
          if (!isRetryableTriggerSessionStreamError(error)) {
            throw error;
          }
          lastError = error;
        }
      }
    }

    return iterableToReadableStream(chunks());
  }
}
