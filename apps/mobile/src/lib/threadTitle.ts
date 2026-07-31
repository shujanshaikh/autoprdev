export const DEFAULT_THREAD_TITLE = "New thread";
export const MAX_THREAD_TITLE_ATTEMPTS = 3;
const MAX_THREAD_TITLE_MESSAGE_LENGTH = 8_000;

export function threadTitleRetryDelayMs(attempt: number) {
  return attempt === 0 ? 750 : Math.min(8_000, 1_500 * 2 ** (attempt - 1));
}

export function shouldRetryThreadTitleError(cause: unknown) {
  if (
    typeof cause === "object"
    && cause !== null
    && "retryable" in cause
    && typeof cause.retryable === "boolean"
  ) {
    return cause.retryable;
  }
  return true;
}

export function firstUserMessageText(
  messages: ReadonlyArray<{ role: string; parts: readonly unknown[] }>,
) {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts.flatMap((part) => {
      if (
        typeof part === "object"
        && part !== null
        && "type" in part
        && part.type === "text"
        && "text" in part
        && typeof part.text === "string"
      ) {
        return part.text.trim() ? [part.text.trim()] : [];
      }
      return [];
    }).join("\n");
    if (text) return text.slice(0, MAX_THREAD_TITLE_MESSAGE_LENGTH);
    const hasFile = message.parts.some((part) =>
      typeof part === "object"
      && part !== null
      && "type" in part
      && part.type === "file");
    if (hasFile) return "Review the attached image";
  }
  return undefined;
}
