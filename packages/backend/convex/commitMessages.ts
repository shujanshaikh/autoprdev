"use node";

import { gateway, generateText } from "ai";
import { v } from "convex/values";

import { action } from "./_generated/server";

const COMMIT_MESSAGE_MODEL_ID = "openai/gpt-5.4-mini";
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

export const generate = action({
  args: {
    projectId: v.string(),
    branch: v.string(),
    status: v.string(),
    diff: v.string(),
  },
  handler: async (_ctx, args) => {
    const diff = trimForCommitPrompt(args.diff);
    const { text } = await generateText({
      model: gateway(COMMIT_MESSAGE_MODEL_ID),
      system: [
        "Write a concise Git commit subject for the provided repository changes.",
        "Return exactly one line. Do not use markdown, quotes, prefixes, or explanations.",
        "Use present-tense imperative style. Prefer 72 characters or fewer when possible.",
      ].join("\n"),
      prompt: [
        `Current branch: ${args.branch}`,
        "",
        "Git status:",
        args.status,
        "",
        "Staged diff:",
        diff,
      ].join("\n"),
      maxOutputTokens: 64,
      maxRetries: 1,
      timeout: 60_000,
      providerOptions: {
        gateway: {
          tags: [`autopr-commit-${args.projectId}`],
        },
      },
    });

    return normalizeGeneratedCommitMessage(text);
  },
});
