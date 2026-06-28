import "@tanstack/react-start/server-only";

import { streamText } from "ai";

import { createAuthenticatedCodexResponsesModel } from "#/lib/codex-auth-server";
import { DEFAULT_CODEX_REASONING_EFFORT } from "#/lib/codex-models";

export const COMMIT_MESSAGE_MODEL_ID = "gpt-5.4";

const MAX_COMMIT_MESSAGE_DIFF_CHARS = 60_000;

function trimForCommitPrompt(value: string) {
  if (value.length <= MAX_COMMIT_MESSAGE_DIFF_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_COMMIT_MESSAGE_DIFF_CHARS)}\n\n[Diff truncated for commit message generation.]`;
}

function normalizeGeneratedCommitMessage(value: string) {
  const message = value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 180)
    .trim();

  return message || "Update project changes";
}

function commitMessagePromptCacheKey(projectId: string, threadId: string) {
  const stableSegment = `${projectId}-${threadId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
  return `autopr-commit-${stableSegment}`;
}

export async function generateCommitMessage(options: {
  projectId: string;
  threadId: string;
  branch: string;
  status: string;
  diff: string;
}) {
  const promptCacheKey = commitMessagePromptCacheKey(options.projectId, options.threadId);
  const model = await createAuthenticatedCodexResponsesModel({
    modelId: COMMIT_MESSAGE_MODEL_ID,
    reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
    promptCacheKey,
    disconnectedMessage: "Connect Codex before generating a commit message.",
  });

  const result = streamText({
    model,
    system: [
      "Write a concise Git commit subject for the provided repository changes.",
      "Return exactly one line. Do not use markdown, quotes, prefixes, or explanations.",
      "Use present-tense imperative style. Prefer 72 characters or fewer when possible.",
    ].join("\n"),
    prompt: [
      `Current branch: ${options.branch}`,
      "",
      "Git status:",
      options.status,
      "",
      "Staged diff:",
      trimForCommitPrompt(options.diff),
    ].join("\n"),
    maxOutputTokens: 64,
    maxRetries: 1,
    timeout: {
      totalMs: 60_000,
      chunkMs: 30_000,
    },
    providerOptions: {
      openai: {
        store: false,
        promptCacheKey,
        reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
      },
    },
  });

  return normalizeGeneratedCommitMessage(await result.text);
}
