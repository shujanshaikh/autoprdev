import { getSandboxContext, type SandboxSessionOptions } from "./sandbox";
import { resolveSandboxPath } from "./sandbox/execute";
import type { BuildSystemPromptContextFile } from "./system-prompt";

const DEFAULT_PROJECT_INSTRUCTION_FILENAMES = ["AGENTS.override.md", "AGENTS.md"];
const DEFAULT_PROJECT_INSTRUCTION_MAX_BYTES = 32 * 1024;

export interface LoadProjectInstructionsOptions {
  cwd: string;
  projectRoot?: string;
  filenames?: string[];
  maxBytes?: number;
}

interface LoadedInstructionFile {
  path: string;
  bytes: number;
  content: string;
  truncated: boolean;
}

export async function loadSandboxProjectInstructions(
  sandboxOptions: SandboxSessionOptions,
  options: LoadProjectInstructionsOptions,
): Promise<BuildSystemPromptContextFile[]> {
  const context = await getSandboxContext(sandboxOptions);
  const projectRoot = normalizeRemotePath(resolveSandboxPath(options.projectRoot, context.workDir));
  const cwd = normalizeRemotePath(resolveSandboxPath(options.cwd, projectRoot));
  const maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_PROJECT_INSTRUCTION_MAX_BYTES);
  const filenames = options.filenames?.length ? options.filenames : DEFAULT_PROJECT_INSTRUCTION_FILENAMES;

  if (maxBytes === 0) {
    return [];
  }

  const loadedFiles: LoadedInstructionFile[] = [];
  let bytesUsed = 0;

  for (const directory of instructionDirectories(projectRoot, cwd)) {
    if (bytesUsed >= maxBytes) {
      break;
    }

    const loadedFile = await readFirstInstructionFile(sandboxOptions, directory, filenames, maxBytes - bytesUsed);
    if (!loadedFile) {
      continue;
    }

    bytesUsed += loadedFile.bytes;
    loadedFiles.push(loadedFile);
  }

  return loadedFiles.map(({ path, content, truncated }) => ({
    path: relativeInstructionPath(projectRoot, path),
    content: truncated ? `${content}\n\n[Instruction file truncated by harness byte limit.]` : content,
  }));
}

async function readFirstInstructionFile(
  sandboxOptions: SandboxSessionOptions,
  directory: string,
  filenames: string[],
  maxBytes: number,
): Promise<LoadedInstructionFile | undefined> {
  const context = await getSandboxContext(sandboxOptions);

  for (const filename of filenames) {
    const path = `${directory.replace(/\/+$/, "")}/${filename}`;

    try {
      const bytes = Buffer.from(await context.sandbox.fs.downloadFile(path));
      if (bytes.length === 0) {
        continue;
      }

      const truncated = bytes.length > maxBytes;
      const visibleBytes = truncated ? bytes.subarray(0, maxBytes) : bytes;
      const content = visibleBytes.toString("utf8").trim();
      if (!content) {
        continue;
      }

      return {
        path,
        bytes: visibleBytes.length,
        content,
        truncated,
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function instructionDirectories(projectRoot: string, cwd: string): string[] {
  if (cwd === projectRoot) {
    return [projectRoot];
  }

  const root = projectRoot.replace(/\/+$/, "");
  const current = cwd.replace(/\/+$/, "");
  if (!current.startsWith(`${root}/`)) {
    return [projectRoot];
  }

  const relativeParts = current.slice(root.length + 1).split("/").filter(Boolean);
  const directories = [root];
  let cursor = root;

  for (const part of relativeParts) {
    cursor = `${cursor}/${part}`;
    directories.push(cursor);
  }

  return directories;
}

function normalizeRemotePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function relativeInstructionPath(projectRoot: string, path: string): string {
  const root = projectRoot.replace(/\/+$/, "");
  const normalized = normalizeRemotePath(path);
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}
