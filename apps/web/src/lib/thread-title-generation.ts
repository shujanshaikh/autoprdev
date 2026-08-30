import type { UIMessage } from "ai";
import { isTemporaryThreadFeatureBranch } from "@autopr/backend/convex/lib/threadWorktree";

export const DEFAULT_THREAD_TITLE = "New thread";
export const MAX_THREAD_TITLE_REQUEST_ATTEMPTS = 3;

export class ThreadTitleRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ThreadTitleRequestError";
    this.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

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

export function shouldRequestThreadMetadata(options: {
  title?: string;
  featureBranch?: string;
  threadId: string;
  worktreeStatus?: "pending" | "provisioning" | "ready" | "failed" | "cleaned";
}) {
  if (options.title === DEFAULT_THREAD_TITLE) return true;
  return options.worktreeStatus === "ready"
    && isTemporaryThreadFeatureBranch(options.featureBranch, options.threadId);
}

export async function requestGeneratedThreadTitle(options: {
  projectId: string;
  threadId: string;
  signal?: AbortSignal;
} & (
  | { message: string; regenerate?: false }
  | { regenerate: true }
)) {
  const response = await fetch(
    `/api/project/${encodeURIComponent(options.projectId)}/thread/${encodeURIComponent(options.threadId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.regenerate
        ? { action: "regenerate_title" }
        : { action: "generate_title", message: options.message }),
      signal: options.signal,
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new ThreadTitleRequestError(
      payload?.error || `Thread title generation failed with status ${response.status}.`,
      response.status,
    );
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
