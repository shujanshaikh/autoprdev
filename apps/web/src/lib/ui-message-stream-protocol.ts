import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

type SendOptions<UI_MESSAGE extends UIMessage> = Parameters<
  ChatTransport<UI_MESSAGE>["sendMessages"]
>[0];
type ReconnectOptions<UI_MESSAGE extends UIMessage> = Parameters<
  ChatTransport<UI_MESSAGE>["reconnectToStream"]
>[0];

/**
 * Repairs text-part boundaries without reconnecting or buffering text.
 *
 * Durable streams can resume after a text-start record, and some providers
 * can deliver a final delta immediately after text-end. AI SDK treats both as
 * fatal protocol errors even though every delta still contains usable text.
 */
export function repairUIMessageStreamProtocol(
  stream: ReadableStream<UIMessageChunk>,
) {
  const activeTextParts = new Set<string>();
  const pendingTextEnds = new Map<
    string,
    Extract<UIMessageChunk, { type: "text-end" }>
  >();

  function flushPendingTextEnds(
    controller: TransformStreamDefaultController<UIMessageChunk>,
    keepId?: string,
  ) {
    for (const [id, chunk] of pendingTextEnds) {
      if (id === keepId) continue;
      controller.enqueue(chunk);
      activeTextParts.delete(id);
      pendingTextEnds.delete(id);
    }
  }

  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type === "text-end") {
        if (activeTextParts.has(chunk.id)) {
          pendingTextEnds.set(chunk.id, chunk);
        }
        return;
      }

      if (chunk.type === "text-delta") {
        // A late delta may continue its own just-ended part, but a different
        // part must close before this one starts to avoid overlapping IDs.
        flushPendingTextEnds(controller, chunk.id);

        // Keep the existing part open when a provider puts its final delta
        // just after text-end.
        if (!activeTextParts.has(chunk.id)) {
          controller.enqueue({ type: "text-start", id: chunk.id });
          activeTextParts.add(chunk.id);
        }

        controller.enqueue(chunk);
        return;
      }

      flushPendingTextEnds(controller);

      if (chunk.type === "text-start") {
        activeTextParts.add(chunk.id);
      }

      controller.enqueue(chunk);
    },
    flush(controller) {
      flushPendingTextEnds(controller);
    },
  }));
}

export class UIMessageStreamProtocolTransport<UI_MESSAGE extends UIMessage>
  implements ChatTransport<UI_MESSAGE>
{
  constructor(private readonly transport: ChatTransport<UI_MESSAGE>) {}

  sendMessages = async (options: SendOptions<UI_MESSAGE>) =>
    repairUIMessageStreamProtocol(await this.transport.sendMessages(options));

  reconnectToStream = async (options: ReconnectOptions<UI_MESSAGE>) => {
    const stream = await this.transport.reconnectToStream(options);
    return stream ? repairUIMessageStreamProtocol(stream) : null;
  };
}
