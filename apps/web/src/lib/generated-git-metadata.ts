import "@tanstack/react-start/server-only";

import { streamText } from "ai";
import { z } from "zod";

import { createSemanticFeatureBranch } from "@autopr/backend/convex/lib/threadWorktree";
import { createAuthenticatedCodexResponsesModel } from "#/lib/codex-auth-server";
import { DEFAULT_CODEX_REASONING_EFFORT } from "#/lib/codex-models";

const MAX_PROMPT_PATCH_CHARS = 40_000;

function limitPromptSection(value: string, maximum = MAX_PROMPT_PATCH_CHARS) {
  const trimmed = value.trim();
  return trimmed.length <= maximum
    ? trimmed
    : `${trimmed.slice(0, maximum)}\n\n[Content truncated.]`;
}

function firstMeaningfulLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function stripWrappingQuotes(value: string) {
  return value.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

export function parseGeneratedMetadata<T>(value: string, schema: z.ZodType<T>): T {
  const trimmed = value.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const objectStart = withoutFence.indexOf("{");
  const objectEnd = withoutFence.lastIndexOf("}");
  const candidates = [
    withoutFence,
    ...(objectStart >= 0 && objectEnd > objectStart
      ? [withoutFence.slice(objectStart, objectEnd + 1)]
      : []),
  ];

  for (const candidate of candidates) {
    try {
      const parsed = schema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next candidate when the model adds prose around its JSON.
    }
  }

  throw new Error("Codex returned invalid generated metadata.");
}

export function normalizeGeneratedThreadTitle(value: string, fallbackMessage: string) {
  const fallback = firstMeaningfulLine(fallbackMessage)
    .replace(/^(please\s+)?(can you\s+|could you\s+|i want (you )?to\s+|help me\s+)/i, "")
    .replace(/[.!?,;:]+$/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join(" ");
  const title = stripWrappingQuotes(firstMeaningfulLine(value))
    .replace(/^(title|thread)\s*:\s*/i, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (title || fallback || "New thread").slice(0, 50).trim();
}

export function normalizeGeneratedCommitMessage(value: string) {
  const message = stripWrappingQuotes(firstMeaningfulLine(value))
    .replace(/^(subject|commit(?: message)?)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .slice(0, 180)
    .trim();

  return message || "Update project changes";
}

function fallbackPrTitle(commitSummary: string, headBranch: string) {
  const commitSubject = commitSummary
    .split(/\r?\n/)
    .map((line) => line.replace(/^[*\-\s]+/, "").replace(/^[0-9a-f]{7,40}\s+/i, "").trim())
    .find(Boolean);
  const branchSubject = headBranch
    .replace(/^refs\/heads\//, "")
    .replace(/^[^/]+\//, "")
    .replace(/[-_]+/g, " ")
    .trim();

  return normalizeGeneratedCommitMessage(commitSubject || branchSubject || "Update project changes").slice(0, 180);
}

function summaryBullets(commitSummary: string, diffSummary: string) {
  const commits = commitSummary
    .split(/\r?\n/)
    .map((line) => line.replace(/^[0-9a-f]{7,40}\s+/i, "").trim())
    .filter(Boolean)
    .slice(0, 3);

  if (commits.length > 0) return commits.map((commit) => `- ${commit}`).join("\n");

  const files = diffSummary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/files? changed/i.test(line))
    .slice(0, 3);
  return files.length > 0
    ? files.map((file) => `- Update ${file}`).join("\n")
    : "- Update project changes";
}

export function createPullRequestFallback(options: {
  commitSummary: string;
  diffSummary: string;
  headBranch: string;
  template?: string;
}) {
  const summary = summaryBullets(options.commitSummary, options.diffSummary);
  const template = options.template?.trim();
  return {
    title: fallbackPrTitle(options.commitSummary, options.headBranch),
    body: template
      ? `${template}\n\n## Auto-generated summary\n${summary}`.slice(0, 5_000).trim()
      : [
          "## Summary",
          summary,
          "",
          "## Testing",
          "- Not run (not provided)",
        ].join("\n"),
  };
}

function promptCacheKey(kind: string, projectId: string, threadId: string) {
  const stableSegment = `${projectId}-${threadId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
  return `autopr-${kind}-${stableSegment}`;
}

export interface GitMetadataDependencies {
  createCodexModel: typeof createAuthenticatedCodexResponsesModel;
}

const defaultDependencies: GitMetadataDependencies = {
  createCodexModel: createAuthenticatedCodexResponsesModel,
};

async function metadataModel(
  request: Request,
  disconnectedMessage: string,
  dependencies: GitMetadataDependencies,
) {
  return dependencies.createCodexModel({
    request,
    reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
    disconnectedMessage,
  });
}

const sharedGenerationOptions = {
  maxRetries: 1,
  timeout: { totalMs: 60_000, chunkMs: 30_000 },
} as const;

/**
 * Runs a one-shot Codex generation and returns its text.
 *
 * The ChatGPT-backed Codex responses endpoint only accepts streaming requests,
 * so a non-streaming `generateText` call is rejected with `400 Bad Request`.
 * Streaming and collecting the text keeps the upstream failure (and its status
 * code) intact for callers that map it onto an HTTP response.
 */
async function generateMetadataText(options: Parameters<typeof streamText>[0]) {
  let streamError: unknown;
  const result = streamText({
    ...options,
    onError: ({ error }) => {
      streamError = error;
    },
  });

  let text = "";
  try {
    text = (await result.text).trim();
  } catch (error) {
    throw streamError ?? error;
  }

  if (text) return text;

  throw streamError ?? new Error("Codex returned no generated metadata.");
}

export async function generateThreadTitle(options: {
  request: Request;
  projectId: string;
  threadId: string;
  message: string;
}, dependencies: GitMetadataDependencies = defaultDependencies) {
  const model = await metadataModel(options.request, "Connect Codex before generating a thread title.", dependencies);
  const schema = z.object({ title: z.string().trim().min(1) });
  const text = await generateMetadataText({
    model,
    prompt: [
      "You write concise thread titles for coding conversations.",
      "Return a JSON object with key: title.",
      "Rules:",
      "- Summarize the user's request rather than repeating it verbatim.",
      "- Keep it short and specific (3-8 words).",
      "- Avoid quotes, filler, prefixes, and trailing punctuation.",
      "",
      "User message:",
      limitPromptSection(options.message, 8_000),
    ].join("\n"),
    maxOutputTokens: 80,
    ...sharedGenerationOptions,
    providerOptions: {
      openai: {
        store: false,
        promptCacheKey: promptCacheKey("thread-title", options.projectId, options.threadId),
        reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
      },
    },
  });
  const generated = parseGeneratedMetadata(text, schema);
  return normalizeGeneratedThreadTitle(generated.title, options.message);
}

export async function generateBranchName(options: {
  request: Request;
  projectId: string;
  threadId: string;
  message: string;
}, dependencies: GitMetadataDependencies = defaultDependencies) {
  const fallback = createSemanticFeatureBranch(options.message);
  try {
    const model = await metadataModel(options.request, "Connect Codex before generating a branch name.", dependencies);
    const schema = z.object({ branch: z.string() });
    const text = await generateMetadataText({
      model,
      prompt: [
        "You generate concise Git branch names.",
        "Return a JSON object with key: branch.",
        "Rules:",
        "- Describe the requested work in 2-6 short, specific words.",
        "- Use plain words without an issue prefix, namespace, random identifier, or punctuation-heavy text.",
        "",
        "Requested work:",
        limitPromptSection(options.message, 8_000),
      ].join("\n"),
      maxOutputTokens: 64,
      ...sharedGenerationOptions,
      providerOptions: {
        openai: {
          store: false,
          promptCacheKey: promptCacheKey("branch", options.projectId, options.threadId),
          reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
        },
      },
    });
    const generated = parseGeneratedMetadata(text, schema);
    return createSemanticFeatureBranch(generated.branch);
  } catch {
    return fallback;
  }
}

export async function generateCommitMetadata(options: {
  request: Request;
  projectId: string;
  threadId: string;
  branch: string;
  status: string;
  diff: string;
  fallbackTitle?: string;
  includeBranch?: boolean;
}, dependencies: GitMetadataDependencies = defaultDependencies) {
  const fallbackCommitMessage = normalizeGeneratedCommitMessage(options.fallbackTitle || "Update project changes");
  const fallbackBranch = createSemanticFeatureBranch(options.fallbackTitle || fallbackCommitMessage);

  try {
    const model = await metadataModel(options.request, "Connect Codex before generating Git metadata.", dependencies);
    const schema = options.includeBranch
      ? z.object({ subject: z.string(), branch: z.string() })
      : z.object({ subject: z.string(), branch: z.string().optional() });
    const text = await generateMetadataText({
      model,
      prompt: [
        "You write concise Git metadata for repository changes.",
        options.includeBranch
          ? "Return a JSON object with keys: subject, branch."
          : "Return a JSON object with key: subject.",
        "Rules:",
        "- subject must be imperative, concise, at most 72 characters, and have no trailing period",
        ...(options.includeBranch
          ? [
              "- branch must describe the primary change in 2-6 plain words",
              "- branch must not include refs/heads, a namespace, an issue number, or a random identifier",
            ]
          : []),
        "",
        `Current branch: ${options.branch}`,
        "",
        "Git status:",
        limitPromptSection(options.status, 6_000),
        "",
        "Staged changes:",
        limitPromptSection(options.diff),
      ].join("\n"),
      maxOutputTokens: 120,
      ...sharedGenerationOptions,
      providerOptions: {
        openai: {
          store: false,
          promptCacheKey: promptCacheKey("commit", options.projectId, options.threadId),
          reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
        },
      },
    });
    const generated = parseGeneratedMetadata(text, schema);
    const commitMessage = normalizeGeneratedCommitMessage(generated.subject);
    return {
      commitMessage,
      branchName: options.includeBranch
        ? createSemanticFeatureBranch(generated.branch || commitMessage)
        : undefined,
    };
  } catch {
    return {
      commitMessage: fallbackCommitMessage,
      branchName: options.includeBranch ? fallbackBranch : undefined,
    };
  }
}

export async function generatePullRequestContent(options: {
  request: Request;
  projectId: string;
  threadId: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  template?: string;
}, dependencies: GitMetadataDependencies = defaultDependencies) {
  const fallback = createPullRequestFallback(options);
  try {
    const model = await metadataModel(options.request, "Connect Codex before generating pull request details.", dependencies);
    const hasTemplate = Boolean(options.template?.trim());
    const schema = z.object({ title: z.string(), body: z.string() });
    const text = await generateMetadataText({
      model,
      prompt: [
        "You write source-control pull request content from the actual repository changes.",
        "Return a JSON object with keys: title, body.",
        "Rules:",
        "- title must be concise, specific, and at most 72 characters",
        ...(hasTemplate
          ? [
              "- body must follow the repository pull request template",
              "- fill relevant sections and remove HTML comments",
            ]
          : [
              "- body must use the headings '## Summary' and '## Testing'",
              "- use short bullets under Summary",
              "- list concrete checks under Testing, or use 'Not run (not provided)'",
            ]),
        ...(hasTemplate ? ["", "Repository pull request template:", limitPromptSection(options.template!, 8_000)] : []),
        "",
        `Base branch: ${options.baseBranch}`,
        `Head branch: ${options.headBranch}`,
        "",
        "Commits:",
        limitPromptSection(options.commitSummary, 12_000),
        "",
        "Diff stat:",
        limitPromptSection(options.diffSummary, 12_000),
        "",
        "Diff patch:",
        limitPromptSection(options.diffPatch),
      ].join("\n"),
      maxOutputTokens: 1_200,
      ...sharedGenerationOptions,
      providerOptions: {
        openai: {
          store: false,
          promptCacheKey: promptCacheKey("pull-request", options.projectId, options.threadId),
          reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
        },
      },
    });
    const generated = parseGeneratedMetadata(text, schema);
    const title = stripWrappingQuotes(firstMeaningfulLine(generated.title)).slice(0, 180).trim();
    const body = generated.body.trim().slice(0, 5_000);
    return {
      title: title || fallback.title,
      body: body || fallback.body,
    };
  } catch {
    return fallback;
  }
}
