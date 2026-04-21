const TOOL_SNIPPETS: Record<string, string> = {
  sandboxInfo: "Inspect the current Daytona sandbox id, snapshot, and working directory",
  read: "Read file contents",
  ls: "List directory contents",
  find: "Find files by glob pattern",
  grep: "Search file contents for patterns",
  edit: "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
  write: "Create or overwrite files",
  bash: "Execute shell commands inside the Daytona sandbox",
};

const TOOL_PROMPT_GUIDELINES: Record<string, string[]> = {
  read: ["Use read to examine files instead of cat or sed."],
  edit: [
    "Use edit for precise changes. Each edits[].oldText must match exactly once.",
    "When changing multiple separate locations in one file, use one edit call with multiple entries.",
    "Each edits[].oldText is matched against the original file. Do not emit overlapping or nested edits.",
  ],
  write: ["Use write only for new files or complete rewrites."],
};

export interface BuildSystemPromptOptions {
  cwd: string;
  sandboxId: string;
  sandboxName?: string;
  snapshot?: string;
  selectedTools?: string[];
  appendSystemPrompt?: string;
}

export function buildSandboxAgentSystemPrompt(options: BuildSystemPromptOptions): string {
  const selectedTools = options.selectedTools ?? Object.keys(TOOL_SNIPPETS);
  const date = new Date().toISOString().slice(0, 10);
  const toolsList = selectedTools
    .filter((name) => Boolean(TOOL_SNIPPETS[name]))
    .map((name) => `- ${name}: ${TOOL_SNIPPETS[name]}`)
    .join("\n");
  const guidelines = new Set<string>([
    "You are operating inside a Daytona sandbox, not the user's local machine.",
    "Be concise and explain important command or file changes clearly.",
    "Prefer ls/find/grep/read tools over bash for file exploration.",
    "Use bash for package installs, scripts, tests, and commands that need a shell.",
    "Show sandbox file paths clearly when working with files.",
  ]);

  for (const toolName of selectedTools) {
    for (const guideline of TOOL_PROMPT_GUIDELINES[toolName] ?? []) {
      guidelines.add(guideline);
    }
  }

  const sandboxName = options.sandboxName ? `\nSandbox name: ${options.sandboxName}` : "";
  const snapshot = options.snapshot ? `\nSnapshot: ${options.snapshot}` : "";
  const append = options.appendSystemPrompt ? `\n\n${options.appendSystemPrompt}` : "";

  return `You are an expert coding assistant running in a Daytona sandbox.

Available tools:
${toolsList || "(none)"}

Guidelines:
${[...guidelines].map((guideline) => `- ${guideline}`).join("\n")}

Current date: ${date}
Sandbox ID: ${options.sandboxId}${sandboxName}${snapshot}
Current working directory: ${options.cwd}${append}`;
}
