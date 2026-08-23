import { hasObjectType } from "@autopr/config/runtime-type";
import { type JsonObject } from "@autopr/config/runtime-value";

import { Daytona, type Sandbox } from "@daytona/sdk";
import { sandboxDomainAllowList } from "@autopr/config/sandbox-network-policy";

import { DEFAULT_SANDBOX_WORKDIR, sandboxRepositoryDirectoryName, sandboxRepositoryPath } from "./repo-path";

export {
  DEFAULT_SANDBOX_WORKDIR,
  sandboxRelativeRepositoryPath,
  sandboxRepositoryDirectoryName,
  sandboxRepositoryPath,
} from "./repo-path";
export {
  DEFAULT_SANDBOX_DOMAIN_ALLOW_LIST,
  sandboxDomainAllowList,
} from "@autopr/config/sandbox-network-policy";

export interface SandboxContext {
  sandbox: DaytonaSandbox;
  workDir: string;
}

export type DaytonaSandbox = Sandbox;

export interface SandboxSessionOptions {
  cacheKey?: string;
  sandboxId?: string;
  snapshot?: string;
  name?: string;
  labels?: Record<string, string>;
  repoUrl?: string;
  repoBranch?: string;
  repoName?: string;
  workDir?: string;
}

// Default Daytona snapshot to use when DAYTONA_SNAPSHOT is not configured.
const DEFAULT_DAYTONA_SNAPSHOT = "autopr-cua";
const SANDBOX_AUTO_STOP_INTERVAL_MINUTES = 15;
const SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES = 2 * 60;
const SANDBOX_START_TIMEOUT_SECONDS = 120;
const DAYTONA_RATE_LIMIT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;
const SANDBOX_LOOKUP_CACHE_MS = 5_000;
const sandboxContextPromises = new Map<string, {
  promise: Promise<SandboxContext>;
  expiresAt: number;
}>();
const sandboxLookupPromises = new Map<string, Promise<DaytonaSandbox>>();
const recentSandboxes = new Map<string, { sandbox: DaytonaSandbox; expiresAt: number }>();

function errorMessage<ErrorValue>(error: ErrorValue) {
  return error instanceof Error ? error.message : String(error);
}

function isDaytonaRateLimitError<ErrorValue>(error: ErrorValue) {
  if (error instanceof Error && error.name === "DaytonaRateLimitError") return true;
  const message = errorMessage(error).toLowerCase();
  if (message.includes("too many requests") || message.includes("throttlerexception")) return true;
  if (!error || !hasObjectType(error)) return false;
  const record = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ error as JsonObject;
  return record.status === 429
    || record.status === "429"
    || record.statusCode === 429
    || record.statusCode === "429"
    || record.code === 429
    || record.code === "429";
}

async function retryDaytonaRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = DAYTONA_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
      if (!isDaytonaRateLimitError(error) || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

interface ResolvedSandboxSessionOptions {
  cacheKey: string;
  sandboxId?: string;
  snapshot: string;
  name?: string;
  labels?: Record<string, string>;
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
    name: options.name,
    labels: options.labels,
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

export interface SandboxDependencies {
  createDaytonaClient: () => Pick<Daytona, "create" | "delete" | "get"> | Promise<Pick<Daytona, "create" | "delete" | "get">>;
}

const defaultDependencies: SandboxDependencies = { createDaytonaClient };

async function ensureSandboxNetworkPolicy(sandbox: DaytonaSandbox) {
  const domainAllowList = sandboxDomainAllowList(process.env.DAYTONA_DOMAIN_ALLOW_LIST);
  if (sandboxDomainAllowList(sandbox.domainAllowList) === domainAllowList) return sandbox;
  if (sandbox.state && sandbox.state !== "started") {
    // A stopped sandbox can safely start with its existing, stricter policy so
    // the now-unrestricted default can be applied once Daytona accepts updates.
    if (!domainAllowList) return sandbox;
    throw new Error(
      "Refusing to start a sandbox whose network policy is missing or outdated. Recreate the sandbox to apply the configured domain allow-list before startup.",
    );
  }
  await sandbox.updateNetworkSettings({ domainAllowList });
  sandbox.domainAllowList = domainAllowList;
  return sandbox;
}

export async function createSandbox(
  options: SandboxSessionOptions = {},
  dependencies: SandboxDependencies = defaultDependencies,
): Promise<DaytonaSandbox> {
  const resolved = resolveSessionOptions(options);
  const daytona = await dependencies.createDaytonaClient();

  if (resolved.sandboxId) {
    const sandboxId = resolved.sandboxId;
    const cached = recentSandboxes.get(sandboxId);
    if (cached && cached.expiresAt > Date.now()) return cached.sandbox;
    if (cached) recentSandboxes.delete(sandboxId);

    const existing = sandboxLookupPromises.get(sandboxId);
    if (existing) return await existing;

    const pending = retryDaytonaRateLimit(async () => {
      const sandbox = await ensureSandboxAutoArchiveInterval(await daytona.get(sandboxId));
      await ensureSandboxNetworkPolicy(sandbox);
      await ensureSandboxStarted(sandbox);
      return ensureSandboxNetworkPolicy(sandbox);
    });
    sandboxLookupPromises.set(sandboxId, pending);
    try {
      const sandbox = await pending;
      recentSandboxes.set(sandboxId, {
        sandbox,
        expiresAt: Date.now() + SANDBOX_LOOKUP_CACHE_MS,
      });
      return sandbox;
    } finally {
      if (sandboxLookupPromises.get(sandboxId) === pending) {
        sandboxLookupPromises.delete(sandboxId);
      }
    }
  }

  return ensureSandboxStarted(
    await daytona.create({
      snapshot: resolved.snapshot,
      name: resolved.name,
      labels: resolved.labels,
      autoStopInterval: SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
      autoArchiveInterval: SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES,
      domainAllowList: sandboxDomainAllowList(process.env.DAYTONA_DOMAIN_ALLOW_LIST),
    }),
  );
}

/** Fetches an existing sandbox without changing its runtime state. */
export async function getSandboxWithoutStarting(sandboxId: string): Promise<DaytonaSandbox> {
  const daytona = createDaytonaClient();
  const sandbox = await daytona.get(sandboxId);
  return ensureSandboxNetworkPolicy(sandbox);
}

export async function deleteSandbox(sandboxId: string): Promise<void> {
  const daytona = await createDaytonaClient();
  const sandbox = await daytona.get(sandboxId);

  await daytona.delete(sandbox);
}


export async function getSandboxContext(
  options: SandboxSessionOptions = {},
  dependencies: SandboxDependencies = defaultDependencies,
): Promise<SandboxContext> {
  const resolved = resolveSessionOptions(options);
  const existingContext = sandboxContextPromises.get(resolved.cacheKey);

  if (existingContext && existingContext.expiresAt > Date.now()) {
    return await existingContext.promise;
  }
  if (existingContext) sandboxContextPromises.delete(resolved.cacheKey);

  const createdContext = createSandbox(resolved, dependencies).then(async (sandbox) => {
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

  const entry = {
    promise: createdContext,
    expiresAt: Number.POSITIVE_INFINITY,
  };
  const recoverableContext = createdContext.then((context) => {
    if (sandboxContextPromises.get(resolved.cacheKey) === entry) {
      entry.expiresAt = Date.now() + SANDBOX_LOOKUP_CACHE_MS;
      const evictionTimer = setTimeout(() => {
        if (
          sandboxContextPromises.get(resolved.cacheKey) === entry
          && entry.expiresAt <= Date.now()
        ) {
          sandboxContextPromises.delete(resolved.cacheKey);
        }
      }, SANDBOX_LOOKUP_CACHE_MS);
      evictionTimer.unref?.();
    }
    return context;
  }).catch((error) => {
    if (sandboxContextPromises.get(resolved.cacheKey) === entry) {
      sandboxContextPromises.delete(resolved.cacheKey);
    }
    throw error;
  });
  entry.promise = recoverableContext;
  sandboxContextPromises.set(resolved.cacheKey, entry);
  return await recoverableContext;
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
