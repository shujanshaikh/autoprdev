export interface SandboxContext {
  sandbox: DaytonaSandbox;
  workDir: string;
}

export interface DaytonaSandbox {
  id: string;
  name?: string;
  snapshot?: string;
  getWorkDir(): Promise<string | undefined>;
  git: {
    status(path: string): Promise<unknown>;
    clone(url: string, path: string, branch?: string): Promise<unknown>;
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
  cacheKey?: string;
  sandboxId?: string;
  snapshot?: string;
  repoUrl?: string;
  repoBranch?: string;
}

const DEFAULT_DAYTONA_SNAPSHOT = "daytonaio/sandbox:0.6.0";
const DEFAULT_SANDBOX_WORKDIR = "/home/daytona";
const SANDBOX_AUTO_STOP_INTERVAL_MS = 30 * 60 * 1000;
const REPO_PATH = "repo";

const sandboxContextPromises = new Map<string, Promise<SandboxContext>>();

interface ResolvedSandboxSessionOptions {
  cacheKey: string;
  sandboxId?: string;
  snapshot: string;
  repoUrl?: string;
  repoBranch?: string;
}

function resolveSessionOptions(options: SandboxSessionOptions = {}): ResolvedSandboxSessionOptions {
  const sandboxId = options.sandboxId ?? process.env.DAYTONA_SANDBOX_ID;
  const snapshot = options.snapshot ?? process.env.DAYTONA_SNAPSHOT ?? DEFAULT_DAYTONA_SNAPSHOT;
  const repoUrl = options.repoUrl ?? process.env.DAYTONA_REPO_URL;
  const repoBranch = options.repoBranch ?? process.env.DAYTONA_REPO_BRANCH;
  const cacheKey = options.cacheKey ?? (sandboxId ? `sandbox:${sandboxId}` : `snapshot:${snapshot}`);

  return {
    cacheKey,
    sandboxId,
    snapshot,
    repoUrl,
    repoBranch,
  };
}

async function resolveSandboxRepoPath(sandbox: DaytonaSandbox): Promise<string> {
  const sandboxWorkDir = (await sandbox.getWorkDir()) ?? DEFAULT_SANDBOX_WORKDIR;
  return `${sandboxWorkDir}/${REPO_PATH}`;
}

async function ensureRepoCloned(
  sandbox: DaytonaSandbox,
  repoUrl: string | undefined,
  repoBranch: string | undefined,
): Promise<string | undefined> {
  if (!repoUrl) {
    return undefined;
  }

  const repoPath = await resolveSandboxRepoPath(sandbox);

  try {
    await sandbox.git.status(REPO_PATH);
    return repoPath;
  } catch {
    await sandbox.git.clone(repoUrl, REPO_PATH, repoBranch);
    return repoPath;
  }
}

export function createSandboxCacheKey(prefix = "sandbox"): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

export async function createSandbox(options: SandboxSessionOptions = {}): Promise<DaytonaSandbox> {
  const resolved = resolveSessionOptions(options);
  const { Daytona } = await import("@daytona/sdk");
  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL,
  });

  if (resolved.sandboxId) {
    return daytona.get(resolved.sandboxId);
  }

  return daytona.create({
    snapshot: resolved.snapshot
  });
}

export async function getSandboxContext(options: SandboxSessionOptions = {}): Promise<SandboxContext> {
  const resolved = resolveSessionOptions(options);
  const existingContext = sandboxContextPromises.get(resolved.cacheKey);

  if (existingContext) {
    return existingContext;
  }

  const createdContext = createSandbox(resolved).then(async (sandbox) => {
    const clonedRepoPath = await ensureRepoCloned(sandbox, resolved.repoUrl, resolved.repoBranch);

    return {
      sandbox,
      workDir: clonedRepoPath ?? (await sandbox.getWorkDir()) ?? DEFAULT_SANDBOX_WORKDIR,
    };
  });

  sandboxContextPromises.set(resolved.cacheKey, createdContext);
  return createdContext;
}

export interface BootstrapRepositorySandboxOptions {
  cacheKey: string;
  repoUrl: string;
  repoBranch?: string;
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
    snapshot: options.snapshot,
  });

  return {
    sandboxId: context.sandbox.id,
    sandboxName: context.sandbox.name,
    snapshot: context.sandbox.snapshot,
    workDir: context.workDir,
  };
}
