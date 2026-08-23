import { hasStringType } from "@autopr/config/runtime-type";
import { isJsonObject, type JsonObject } from "@autopr/config/runtime-value";

import type { FetchLike } from "./types.ts";
import { connectChatGPTRealtime, type ChatGPTRealtimeConnection, type ConnectChatGPTRealtimeOptions } from "./realtime-browser.ts";
import type { ChatGPTRealtimeSessionOptions } from "./realtime.ts";

const MAX_APP_SERVER_EVENT_CHARS = 256 * 1024;

export type ChatGPTRealtimeAppServerEvent =
  | { type: "session.started" }
  | { type: "session.closed" }
  | { type: "handoff"; transcript: string }
  | { type: "tool.running"; callId: string; name: string }
  | { type: "tool.completed"; callId: string; name: string }
  | {
      type: "tool.pending_confirmation";
      callId: string;
      name: string;
      review: unknown;
    }
  | { type: "tool.failed"; callId?: string; name?: string; message: string }
  | { type: "error"; message: string }
  | { type: "keepalive" };

export type ChatGPTRealtimeAppServerSessionOptions = Pick<
  ChatGPTRealtimeSessionOptions,
  "voice" | "model"
>;

export interface ConnectChatGPTRealtimeAppServerOptions
  extends Omit<ConnectChatGPTRealtimeOptions, "endpoint" | "session"> {
  /**
   * Cookie-authenticated app-server route. Defaults to
   * `/api/chatgpt/realtime/app-server`.
   */
  endpoint?: string;
  /** Options understood by the app-server bridge. */
  session?: ChatGPTRealtimeAppServerSessionOptions;
  onBridgeEvent?: (event: ChatGPTRealtimeAppServerEvent) => void;
}

export interface ChatGPTRealtimeAppServerConnection extends ChatGPTRealtimeConnection {
  /** Opaque server-side Live session id. */
  sessionId: string;
  /**
   * Resolves an application-owned pending action. The confirmation payload is
   * intentionally application-defined and must be authorized server-side.
   */
  resolveConfirmation<ConfirmationValue>(callId: string, confirmation: ConfirmationValue): Promise<void>;
  /** Closes the server-side app-server process and waits for acknowledgement. */
  closeServer(): Promise<void>;
}

/**
 * Opens native GPT Live WebRTC audio through the SDK's desktop-style
 * app-server route, subscribes to tool lifecycle events, and exposes explicit
 * confirmation and cleanup controls.
 */
export async function connectChatGPTRealtimeAppServer(
  options: ConnectChatGPTRealtimeAppServerOptions = {},
): Promise<ChatGPTRealtimeAppServerConnection> {
  const {
    endpoint: requestedEndpoint,
    onBridgeEvent,
    ...realtimeOptions
  } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new TypeError("No fetch implementation available.");
  const endpoint = (requestedEndpoint ?? "/api/chatgpt/realtime/app-server").replace(/\/+$/, "");
  let sessionId = "";

  const signalingFetch = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ (async (
    input: Parameters<FetchLike>[0],
    init?: Parameters<FetchLike>[1],
  ) => {
    const response = await fetchImpl(input, init);
    const text = await response.text();
    if (!response.ok) {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Realtime app-server signaling returned invalid JSON.");
    }
    if (!isRecord(payload) || !hasStringType(payload["sessionId"]) ||
        !hasStringType(payload["sdp"]) || !payload["sdp"].trim()) {
      throw new Error("Realtime app-server signaling returned an invalid session.");
    }
    sessionId = payload["sessionId"];
    return new Response(payload["sdp"], {
      status: response.status,
      headers: {
        "content-type": "application/sdp",
        "cache-control": "no-store",
      },
    });
  }) as FetchLike;

  let connection: ChatGPTRealtimeConnection;
  try {
    connection = await connectChatGPTRealtime({
      ...realtimeOptions,
      endpoint,
      fetch: signalingFetch,
    });
  } catch (cause) {
    if (sessionId) {
      await fetchImpl(`${endpoint}/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { accept: "application/json" },
      }).catch(() => {});
    }
    throw cause;
  }
  if (!sessionId) {
    connection.close();
    throw new Error("Realtime app-server signaling returned no session id.");
  }

  const encodedSessionId = encodeURIComponent(sessionId);
  const eventsAbort = new AbortController();
  let serverClosed = false;
  let closePromise: Promise<void> | undefined;
  const report = <CauseValue>(cause: CauseValue) => {
    if (isExpectedStreamCancellation(cause)) return;
    options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
  };
  void streamAppServerEvents(
    fetchImpl,
    `${endpoint}/${encodedSessionId}/events`,
    eventsAbort.signal,
    (event) => {
      try {
        onBridgeEvent?.(event);
      } catch (cause) {
        report(cause);
      }
      if (event.type === "error") report(new Error(event.message));
    },
  ).catch(report);

  function abortServer(): void {
    void closeServer().catch(report);
  }
  function closeServer(): Promise<void> {
    if (closePromise) return closePromise;
    serverClosed = true;
    eventsAbort.abort();
    options.signal?.removeEventListener("abort", abortServer);
    closePromise = fetchImpl(`${endpoint}/${encodedSessionId}`, {
      method: "DELETE",
      credentials: "include",
      headers: { accept: "application/json" },
    }).then(async (response) => {
      if (response.ok || response.status === 404) return;
      throw new Error(
        `Realtime app-server cleanup failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    });
    return closePromise;
  }
  if (options.signal) {
    options.signal.addEventListener("abort", abortServer, { once: true });
    if (options.signal.aborted) abortServer();
  }

  const closeConnection = connection.close;
  return Object.assign(connection, {
    sessionId,
    resolveConfirmation: async <ConfirmationValue>(callId: string, confirmation: ConfirmationValue) => {
      const response = await fetchImpl(`${endpoint}/${encodedSessionId}/confirm`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ callId, confirmation }),
      });
      if (response.ok) return;
      throw new Error(
        `Realtime confirmation failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    },
    closeServer,
    close: () => {
      closeConnection();
      options.signal?.removeEventListener("abort", abortServer);
      if (!serverClosed) void closeServer().catch(report);
    },
  });
}

export function parseChatGPTRealtimeAppServerEvent<ValueValue>(
  value: ValueValue,
): ChatGPTRealtimeAppServerEvent | undefined {
  if (!isRecord(value) || !hasStringType(value["type"])) return undefined;
  switch (value["type"]) {
    case "session.started":
      return { type: "session.started" };
    case "session.closed":
      return { type: "session.closed" };
    case "keepalive":
      return { type: "keepalive" };
    case "handoff":
      return hasStringType(value["transcript"])
        ? { type: "handoff", transcript: value["transcript"] }
        : undefined;
    case "tool.running":
      return hasStringType(value["callId"]) && hasStringType(value["name"])
        ? { type: "tool.running", callId: value["callId"], name: value["name"] }
        : undefined;
    case "tool.completed":
      return hasStringType(value["callId"]) && hasStringType(value["name"])
        ? { type: "tool.completed", callId: value["callId"], name: value["name"] }
        : undefined;
    case "tool.pending_confirmation":
      return hasStringType(value["callId"]) && hasStringType(value["name"])
        && "review" in value
        ? { type: "tool.pending_confirmation", callId: value["callId"], name: value["name"], review: value["review"] }
        : undefined;
    case "tool.failed":
      if (!hasStringType(value["message"])
        || value["callId"] !== undefined && !hasStringType(value["callId"])
        || value["name"] !== undefined && !hasStringType(value["name"])) {
        return undefined;
      }
      const failedEvent: Extract<ChatGPTRealtimeAppServerEvent, { type: "tool.failed" }> = {
        type: "tool.failed",
        message: value["message"],
      };
      if (hasStringType(value["callId"])) failedEvent.callId = value["callId"];
      if (hasStringType(value["name"])) failedEvent.name = value["name"];
      return failedEvent;
    case "error":
      return hasStringType(value["message"])
        ? { type: "error", message: value["message"] }
        : undefined;
    default:
      return undefined;
  }
}

async function streamAppServerEvents(
  fetchImpl: FetchLike,
  url: string,
  signal: AbortSignal,
  onEvent: (event: ChatGPTRealtimeAppServerEvent) => void,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/x-ndjson" },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Realtime app-server event stream failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      while (true) {
        const newline = buffer.indexOf("\n");
        if ((newline < 0 ? buffer.length : newline) > MAX_APP_SERVER_EVENT_CHARS) {
          throw new Error("Realtime app-server event exceeded the maximum line length.");
        }
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            const event = parseChatGPTRealtimeAppServerEvent(JSON.parse(line));
            if (event) onEvent(event);
          } catch {
            // Ignore malformed status lines without interrupting native audio.
          }
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function isExpectedStreamCancellation<CauseValue>(cause: CauseValue): boolean {
  const message = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
  return (
    (cause instanceof DOMException && cause.name === "AbortError")
    || message.includes("aborted")
    || message.includes("body stream buffer")
  );
}

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}
