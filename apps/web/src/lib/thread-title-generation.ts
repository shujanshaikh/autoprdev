import type { UIMessage } from "ai";

export const DEFAULT_THREAD_TITLE = "New thread";
export const MAX_THREAD_TITLE_REQUEST_ATTEMPTS = 3;

export function firstUserMessageForTitle(messages: UIMessage[]) {
  for (const message of messages) {
    if (message.role !== "user") continue;

    const textParts: string[] = [];
    let hasFile = false;
    for (const part of message.parts) {
      if (part.type === "text" && part.text.trim()) {
        textParts.push(part.text.trim());
      } else if (part.type === "file") {
        hasFile = true;
      }
    }

    if (textParts.length > 0) return textParts.join("\n");
    if (hasFile) {
      return "Review the attached image";
    }
  }

  return undefined;
}

export function threadTitleRetryDelayMs(attempt: number) {
  return attempt === 0 ? 750 : Math.min(8_000, 1_500 * 2 ** (attempt - 1));
}

export async function requestGeneratedThreadTitle(options: {
  projectId: string;
  threadId: string;
  message: string;
  signal?: AbortSignal;
}) {
  const response = await fetch(
    `/api/project/${encodeURIComponent(options.projectId)}/thread/${encodeURIComponent(options.threadId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "generate_title",
        message: options.message,
      }),
      signal: options.signal,
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Thread title generation failed with status ${response.status}.`);
  }

  const payload = await response.json().catch(() => null) as {
    title?: string;
    updated?: boolean;
  } | null;

  if (!payload?.title) {
    throw new Error("Thread title generation returned no title.");
  }

  return payload;
}
