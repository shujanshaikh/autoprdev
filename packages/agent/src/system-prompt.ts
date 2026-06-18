const DEFAULT_TOOL_SNIPPETS: Record<string, string> = {
  sandboxInfo: "Inspect the current Daytona sandbox id, snapshot, and working directory",
  read: "Read file contents with line offsets",
  ls: "List directory contents",
  find: "Find files using fff fuzzy search or glob filtering",
  grep: "Search file contents using fff indexed grep",
  edit: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
  write: "Create or overwrite files",
  bash: "Execute shell commands inside the Daytona sandbox",
  computer: "Use the Daytona desktop with Google Chrome for browser demos, screenshots, mouse/keyboard interaction, and screen recordings",
};

const TOOL_PROMPT_GUIDELINES: Record<string, string[]> = {
  sandboxInfo: [
    "Use sandboxInfo when sandbox identity, snapshot, or working directory details are unclear.",
  ],
  read: [
    "Use read to examine file contents before editing; use offset and limit to continue large files.",
  ],
  ls: ["Use ls for quick directory inspection before broader searches."],
  find: [
    "Use find for fuzzy filename, directory, and glob discovery. It is backed by FFF and should be the first choice for path discovery.",
  ],
  grep: [
    "Use grep for code and text search before making assumptions about existing behavior. It is backed by FFF indexed grep with smart-case search.",
  ],
  edit: [
    "Use edit for precise changes. Each edits[].oldText must match exactly once.",
    "When changing multiple separate locations in one file, use one edit call with multiple entries.",
    "Each edits[].oldText is matched against the original file. Do not emit overlapping or nested edits.",
  ],
  write: ["Use write only for new files or complete rewrites where exact replacement is impractical."],
  bash: [
    "Use bash for package installs, scripts, tests, and commands that require a shell.",
    "For long-running commands such as dev servers, preview servers, watchers, and tail -f, set isBackground: true so the command runs in Daytona background mode instead of being killed by foreground execution cleanup.",
    "Prefer the package manager and scripts already present in the repository.",
    "When a command fails, read the error, adjust based on evidence, and avoid repeating the same command unchanged.",
  ],
  computer: [
    "Demo mode is enabled. After the requested work is complete, use the computer tool to record a concise browser demo video of the completed change.",
    "Inspect the repository and terminal state to choose the preview command, localhost URL, route, and UI path yourself.",
    "Demo mode gives you permission to run a dev or preview process inside Daytona when useful; do not assume a hard-coded command or URL.",
    "Use the computer tool with actions[] for small batches of desktop actions; it returns the latest screenshot as image content after relevant screen actions.",
    "For browser tasks, use Google Chrome via computer open_url after choosing the right localhost URL; do not choose Chromium when Chrome is available. Coordinates are absolute screen pixels.",
    "Start recording once the app is ready and the demonstration path is clear; give start_recording and stop_recording the same concise descriptive title for the final embedded video.",
    "Stop recording promptly and mention the recording metadata.",
    "Skip recording only when no meaningful browser preview is possible, and briefly explain the concrete blocker.",
  ],
};

export interface BuildSystemPromptContextFile {
  path: string;
  content: string;
}

export interface BuildSystemPromptOptions {
  cwd: string;
  sandboxId: string;
  sandboxName?: string;
  snapshot?: string;
  selectedTools?: string[];
  toolSnippets?: Record<string, string>;
  promptGuidelines?: string[];
  contextFiles?: BuildSystemPromptContextFile[];
  appendSystemPrompt?: string;
  customPrompt?: string;
  now?: Date;
}

export function buildSandboxAgentSystemPrompt(options: BuildSystemPromptOptions): string {
  const selectedTools = options.selectedTools ?? Object.keys(DEFAULT_TOOL_SNIPPETS);
  const toolSnippets = {
    ...DEFAULT_TOOL_SNIPPETS,
    ...options.toolSnippets,
  };
  const toolsList = formatToolsList(selectedTools, toolSnippets);
  const append = formatAdditionalInstructions(options.appendSystemPrompt);
  const context = formatProjectContext(options.contextFiles ?? []);
  const metadata = formatSandboxMetadata(options);

  if (options.customPrompt) {
    return `${options.customPrompt}${context}${append}${metadata}`;
  }

  return `You are an expert coding assistant operating inside a Daytona sandbox. You help users by reading files, running commands, editing code, and validating the result.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Operating model:
- Treat the Daytona sandbox as the execution environment. Do not imply that commands ran on the user's local machine.
- Treat the current working directory as the source of truth for relative paths.
- Follow repository instructions supplied in project_context. Later instruction files override earlier ones when they conflict.
- Read additional repository docs such as README files and package scripts when they are relevant to the task.
- Inspect existing code before changing it, and prefer the repository's established patterns over inventing new structure.
- Keep changes scoped to the user's request. Preserve unrelated user work and avoid broad rewrites unless they are necessary.
- Prefer typed, maintainable code with clear boundaries between frontend, backend, scripts, and shared packages.
- Validate meaningful changes with the narrowest relevant command available, and report anything you could not run.
- Keep secrets, access tokens, API keys, and private credentials out of prompts, generated artifacts, logs, and final responses.

Guidelines:
${formatGuidelines(selectedTools, options.promptGuidelines ?? [])}
${context}${append}${metadata}`;
}

function formatToolsList(selectedTools: string[], toolSnippets: Record<string, string>): string {
  const visibleTools = selectedTools.filter((name) => Boolean(toolSnippets[name]));

  if (visibleTools.length === 0) {
    return "(none)";
  }

  return visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n");
}

function formatGuidelines(selectedTools: string[], promptGuidelines: string[]): string {
  const guidelines: string[] = [];
  const seen = new Set<string>();
  const addGuideline = (guideline: string): void => {
    const normalized = guideline.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    guidelines.push(normalized);
  };

  const hasBash = selectedTools.includes("bash");
  const fileTools = ["ls", "find", "grep", "read"].filter((toolName) => selectedTools.includes(toolName));

  if (fileTools.length > 0) {
    addGuideline(`Prefer ${fileTools.join("/")} tools over bash for file exploration.`);
    addGuideline(
      `Call independent ${fileTools.join("/")} tools in parallel when gathering context from unrelated files, directories, or search queries.`,
    );
    if (selectedTools.includes("find") || selectedTools.includes("grep")) {
      addGuideline(
        "Do not use bash search commands such as rg, grep, find, fd, or ag for file or content search while find/grep tools are available; those searches must go through the FFF-backed tools.",
      );
    }
  } else if (hasBash) {
    addGuideline("Use bash for file operations like ls, rg, find, cat, and sed.");
  }

  addGuideline(
    "Parallelize independent tool calls when their inputs do not depend on each other and they will not mutate the same files, commands, or sandbox state.",
  );
  addGuideline(
    "Keep dependent or state-changing tool calls sequential, including edits, writes, installs, tests, long-running commands, and commands that rely on prior output.",
  );

  for (const toolName of selectedTools) {
    for (const guideline of TOOL_PROMPT_GUIDELINES[toolName] ?? []) {
      addGuideline(guideline);
    }
  }

  for (const guideline of promptGuidelines) {
    addGuideline(guideline);
  }

  addGuideline("For non-trivial work, briefly state what you are about to inspect or change before using tools.");
  addGuideline("Base decisions on tool output and file contents rather than assumptions.");
  addGuideline("Be concise in user-facing responses while clearly summarizing important command results and file changes.");
  addGuideline("Show sandbox file paths clearly when working with files.");

  return guidelines.map((guideline) => `- ${guideline}`).join("\n");
}

function formatProjectContext(contextFiles: BuildSystemPromptContextFile[]): string {
  if (contextFiles.length === 0) {
    return "";
  }

  const sections = contextFiles.map(
    ({ path, content }) =>
      `<project_instructions path="${escapeXmlAttribute(path)}">\n${content}\n</project_instructions>`,
  );

  return `\n\n<project_context>\nProject-specific instructions and guidelines, ordered from broadest to most specific:\n\n${sections.join("\n\n")}\n</project_context>`;
}

function formatAdditionalInstructions(appendSystemPrompt: string | undefined): string {
  if (!appendSystemPrompt?.trim()) {
    return "";
  }

  return `\n\n<run_context>\n${appendSystemPrompt.trim()}\n</run_context>`;
}

function formatSandboxMetadata(options: BuildSystemPromptOptions): string {
  const date = formatDate(options.now ?? new Date());
  const sandboxName = options.sandboxName ? `\nSandbox name: ${options.sandboxName}` : "";
  const snapshot = options.snapshot ? `\nSnapshot: ${options.snapshot}` : "";
  const cwd = options.cwd.replace(/\\/g, "/");

  return `\n\nCurrent date: ${date}
Sandbox ID: ${options.sandboxId}${sandboxName}${snapshot}
Current working directory: ${cwd}`;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
