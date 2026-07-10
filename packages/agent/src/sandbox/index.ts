import { Daytona } from "@daytona/sdk";

import {
  DEFAULT_SANDBOX_WORKDIR,
  sandboxRepositoryDirectoryName,
  sandboxRepositoryPath,
} from "./repo-path";

export {
  DEFAULT_SANDBOX_WORKDIR,
  sandboxRelativeRepositoryPath,
  sandboxRepositoryDirectoryName,
  sandboxRepositoryPath,
} from "./repo-path";

export interface SandboxContext {
  sandbox: DaytonaSandbox;
  workDir: string;
}

export interface DaytonaSandbox {
  id: string;
  name?: string;
  snapshot?: string;
  state?: string;
  autoArchiveInterval?: number;
  toolboxProxyUrl?: string;
  start(timeout?: number): Promise<void>;
  setAutoArchiveInterval(interval: number): Promise<void>;
  getWorkDir(): Promise<string | undefined>;
  getSignedPreviewUrl(port: number, expiresInSeconds?: number): Promise<{ url: string }>;
  computerUse: {
    start(): Promise<unknown>;
    stop(): Promise<unknown>;
    getStatus(): Promise<unknown>;
    getProcessStatus?(processName: string): Promise<unknown>;
    restartProcess?(processName: string): Promise<unknown>;
    getProcessLogs?(processName: string): Promise<unknown>;
    getProcessErrors?(processName: string): Promise<unknown>;
    mouse: {
      getPosition(): Promise<unknown>;
      move(x: number, y: number): Promise<unknown>;
      click(x: number, y: number, button?: string, double?: boolean): Promise<unknown>;
      drag(startX: number, startY: number, endX: number, endY: number, button?: string): Promise<unknown>;
      scroll(x: number, y: number, direction: "up" | "down", amount?: number): Promise<unknown>;
    };
    keyboard: {
      type(text: string, delay?: number): Promise<void>;
      press(key: string, modifiers?: string[]): Promise<void>;
      hotkey(keys: string): Promise<void>;
    };
    screenshot: {
      takeCompressed(options?: {
        showCursor?: boolean;
        format?: string;
        quality?: number;
        scale?: number;
      }): Promise<unknown>;
      takeCompressedRegion(
        region: { x: number; y: number; width: number; height: number },
        options?: {
          showCursor?: boolean;
          format?: string;
          quality?: number;
          scale?: number;
        },
      ): Promise<unknown>;
    };
    display: {
      getInfo(): Promise<unknown>;
      getWindows(): Promise<unknown>;
    };
    recording: {
      start(label?: string): Promise<unknown>;
      stop(id: string): Promise<unknown>;
      list(): Promise<unknown>;
      get(id: string): Promise<unknown>;
      download(id: string, localPath: string): Promise<void>;
    };
  };
  git: {
    status(path: string): Promise<unknown>;
    clone(url: string, path: string, branch?: string): Promise<unknown>;
    add(path: string, files: string[]): Promise<unknown>;
    commit(
      path: string,
      message: string,
      author: string,
      email: string,
      allowEmpty?: boolean,
    ): Promise<{ sha: string }>;
    push(path: string, username?: string, password?: string): Promise<unknown>;
  };
  fs: {
    downloadFile(path: string): Promise<Uint8Array>;
    uploadFile(file: Uint8Array | Buffer, path: string): Promise<unknown>;
    listFiles(path: string): Promise<unknown[]>;
    searchFiles(path: string, pattern: string): Promise<{ files: string[] }>;
  };
  process: {
    createSession(sessionId: string): Promise<unknown>;
    executeSessionCommand(
      sessionId: string,
      command: {
        command: string;
        runAsync?: boolean;
        suppressInputEcho?: boolean;
      },
      timeout?: number,
    ): Promise<{
      cmdId: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      output?: string;
    }>;
    deleteSession(sessionId: string): Promise<unknown>;
  };
}

export interface SandboxSessionOptions {
  /** Stable orchestrator run ID used to persist mutating-tool idempotency keys. */
  runId?: string;
  cacheKey?: string;
  sandboxId?: string;
  snapshot?: string;
  repoUrl?: string;
  repoBranch?: string;
  repoName?: string;
  workDir?: string;
}

// Default Daytona snapshot to use when DAYTONA_SNAPSHOT is not configured.
const DEFAULT_DAYTONA_SNAPSHOT = "autopr";
const SANDBOX_AUTO_STOP_INTERVAL_MINUTES = 15;
const SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES = 2 * 60;
const SANDBOX_START_TIMEOUT_SECONDS = 120;

const sandboxContextPromises = new Map<string, Promise<SandboxContext>>();

interface ResolvedSandboxSessionOptions {
  cacheKey: string;
  sandboxId?: string;
  snapshot: string;
  repoUrl?: string;
  repoBranch?: string;
  repoName?: string;
  workDir?: string;
}

function resolveSessionOptions(options: SandboxSessionOptions = {}): ResolvedSandboxSessionOptions {
  const sandboxId = options.sandboxId ?? process.env.DAYTONA_SANDBOX_ID;
  const snapshot = options.snapshot ?? process.env.DAYTONA_SNAPSHOT ?? DEFAULT_DAYTONA_SNAPSHOT;
  const repoUrl = options.repoUrl ?? process.env.DAYTONA_REPO_URL;
  const repoBranch = options.repoBranch ?? process.env.DAYTONA_REPO_BRANCH;
  const repoName = options.repoName ?? process.env.DAYTONA_REPO_NAME;
  const workDir = options.workDir ?? process.env.DAYTONA_WORKDIR;
  const cacheKey = options.cacheKey ?? (sandboxId ? `sandbox:${sandboxId}` : `snapshot:${snapshot}`);

  return {
    cacheKey,
    sandboxId,
    snapshot,
    repoUrl,
    repoBranch,
    repoName,
    workDir,
  };
}

async function resolveSandboxRepoPath(
  _sandbox: DaytonaSandbox,
  options: { repoName?: string; repoUrl?: string },
): Promise<{ repoPath: string }> {
  const repoDir = sandboxRepositoryDirectoryName(options);
  return {
    repoPath: sandboxRepositoryPath(DEFAULT_SANDBOX_WORKDIR, repoDir),
  };
}

async function ensureSandboxStarted(sandbox: DaytonaSandbox): Promise<DaytonaSandbox> {
  if (sandbox.state && sandbox.state !== "started") {
    await sandbox.start(SANDBOX_START_TIMEOUT_SECONDS);
  }

  return sandbox;
}

async function ensureSandboxAutoArchiveInterval(sandbox: DaytonaSandbox): Promise<DaytonaSandbox> {
  if (sandbox.autoArchiveInterval !== SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES) {
    await sandbox.setAutoArchiveInterval(SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES);
  }

  return sandbox;
}

async function ensureRepoCloned(
  sandbox: DaytonaSandbox,
  repoUrl: string | undefined,
  repoBranch: string | undefined,
  repoName: string | undefined,
): Promise<string | undefined> {
  if (!repoUrl) {
    return undefined;
  }

  const { repoPath } = await resolveSandboxRepoPath(sandbox, { repoName, repoUrl });

  try {
    await sandbox.git.status(repoPath);
    return repoPath;
  } catch {
    await sandbox.git.clone(repoUrl, repoPath, repoBranch);
    return repoPath;
  }
}

export function createSandboxCacheKey(prefix = "sandbox"): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function createDaytonaClient() {
  return new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL,
  });
}

export async function createSandbox(options: SandboxSessionOptions = {}): Promise<DaytonaSandbox> {
  const resolved = resolveSessionOptions(options);
  const daytona = await createDaytonaClient();

  if (resolved.sandboxId) {
    return ensureSandboxStarted(
      await ensureSandboxAutoArchiveInterval(await daytona.get(resolved.sandboxId)),
    );
  }

  return ensureSandboxStarted(
    await daytona.create({
      snapshot: resolved.snapshot,
      autoStopInterval: SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
      autoArchiveInterval: SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES,
    }),
  );
}

export async function deleteSandbox(sandboxId: string): Promise<void> {
  const daytona = await createDaytonaClient();
  const sandbox = await daytona.get(sandboxId);

  await daytona.delete(sandbox);
}


export async function getSandboxContext(options: SandboxSessionOptions = {}): Promise<SandboxContext> {
  const resolved = resolveSessionOptions(options);
  const existingContext = sandboxContextPromises.get(resolved.cacheKey);

  if (existingContext) {
    const context = await existingContext;
    const sandbox = await createSandbox({
      ...resolved,
      sandboxId: context.sandbox.id,
    });
    const refreshedContext = { ...context, sandbox };
    sandboxContextPromises.set(resolved.cacheKey, Promise.resolve(refreshedContext));
    return refreshedContext;
  }

  const createdContext = createSandbox(resolved).then(async (sandbox) => {
    if (resolved.workDir) {
      return {
        sandbox,
        workDir: resolved.workDir,
      };
    }

    const clonedRepoPath = await ensureRepoCloned(sandbox, resolved.repoUrl, resolved.repoBranch, resolved.repoName);

    return {
      sandbox,
      workDir: clonedRepoPath ?? DEFAULT_SANDBOX_WORKDIR,
    };
  });

  sandboxContextPromises.set(resolved.cacheKey, createdContext);
  return createdContext;
}

export interface BootstrapRepositorySandboxOptions {
  cacheKey: string;
  repoUrl: string;
  repoBranch?: string;
  repoName?: string;
  snapshot?: string;
}

export interface BootstrappedRepositorySandbox {
  sandboxId: string;
  sandboxName?: string;
  snapshot?: string;
  workDir: string;
}

export async function bootstrapRepositorySandbox(
  options: BootstrapRepositorySandboxOptions,
): Promise<BootstrappedRepositorySandbox> {
  const context = await getSandboxContext({
    cacheKey: options.cacheKey,
    repoUrl: options.repoUrl,
    repoBranch: options.repoBranch,
    repoName: options.repoName,
    snapshot: options.snapshot,
  });

  return {
    sandboxId: context.sandbox.id,
    sandboxName: context.sandbox.name,
    snapshot: context.sandbox.snapshot,
    workDir: context.workDir,
  };
}
