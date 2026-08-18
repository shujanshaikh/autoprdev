import type { UIMessage } from "ai";

const BASE_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 5_000;

export function restorePersistedAssistantTail(
  messages: UIMessage[],
  persistedMessages: UIMessage[],
) {
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "assistant") {
    return messages;
  }

  const persistedMessage = persistedMessages.find((message) => message.id === lastMessage.id);
  if (!persistedMessage) {
    return messages.slice(0, -1);
  }
  if (persistedMessage === lastMessage) {
    return messages;
  }
  return [...messages.slice(0, -1), persistedMessage];
}

export function shouldUseTriggerSessionTransport(options: {
  sessionCreatedAt?: number;
  currentRunId?: string;
  currentRunTransport?: "task" | "session";
}) {
  if (!options.currentRunId) {
    return false;
  }

  if (options.currentRunTransport) {
    return options.currentRunTransport === "session";
  }

  // Runs started before currentRunTransport was introduced can only be
  // identified by their durable Session history. New runs always persist an
  // explicit transport before either client tries to reconnect.
  return Boolean(options.sessionCreatedAt);
}

export function triggerSessionHydration(
  publicAccessToken: string,
  lastEventId?: string,
) {
  return {
    publicAccessToken,
    lastEventId,
  };
}

export function triggerSessionReconnectDelayMs(attempt: number) {
  return Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** Math.max(0, Math.min(attempt, 5)),
    MAX_RECONNECT_DELAY_MS,
  );
}

export async function runTriggerSessionReconnectAttempt(options: {
  resume: () => Promise<void>;
  isSessionLive: () => boolean;
  isTurnCompleted: () => boolean;
}) {
  let error: unknown;

  try {
    await options.resume();
  } catch (resumeError) {
    error = resumeError;
  }

  return {
    error,
    // AI SDK intentionally resolves resumeStream() when the transport reports
    // that no stream is currently attachable. That can be a short race while
    // a durable Trigger turn is still live, so the caller must try again.
    shouldRetry: options.isSessionLive() && !options.isTurnCompleted(),
  };
}
