"use node";

import * as daytonaSdk from "@daytona/sdk";
import type { Sandbox as DaytonaSandbox } from "@daytona/sdk";
import { sandboxDomainAllowList } from "@autopr/config/sandbox-network-policy";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import { normalizeGithubUrl } from "./lib/github";
import { sandboxCommandText } from "./lib/sandboxCommandOutput";
import {
  autoprSandboxLabels,
  autoprSandboxName,
  isExpectedAutoprSandbox,
} from "./lib/sandboxIdentity";
import {
  assessWorktreeCleanup,
  createThreadFeatureBranch,
  createThreadWorktreePath,
  decideWorktreeProvision,
  parseGitWorktreeList,
  resolveThreadBaseBranch,
  resolveThreadWorkspaceMode,
  type ThreadWorkspaceMode,
} from "./lib/threadWorktree";

const sandboxStatusValidator = v.union(v.literal("creating"), v.literal("ready"), v.literal("failed"));

type SandboxStatus = "creating" | "ready" | "failed";

const DEFAULT_DAYTONA_SNAPSHOT = "autopr";
const DEFAULT_SANDBOX_WORKDIR = "/home";
const SANDBOX_AUTO_STOP_INTERVAL_MINUTES = 15;
const SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES = 2 * 60;
const DAYTONA_NOVNC_PORT = 6080;
const DESKTOP_PREVIEW_EXPIRES_SECONDS = 10 * 60;
const TERMINAL_PREVIEW_EXPIRES_SECONDS = 60;
const TERMINAL_PROCESS_TIMEOUT_MINUTES = 10;
const TERMINAL_PORT_MIN = 30_000;
const TERMINAL_PORT_SPAN = 10_000;
const TERMINAL_PORT_ATTEMPTS = 5;
const TTYD_VERSION = "1.7.7";
const TTYD_SHA256 = {
  aarch64: "b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165",
  x86_64: "8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55",
} as const;
const DESKTOP_STATUS_TIMEOUT_MS = 20_000;
const DESKTOP_STATUS_POLL_MS = 1_000;
const DESKTOP_RECOVERY_DELAY_MS = 1_000;
const MAX_DESKTOP_DIAGNOSTIC_LENGTH = 400;
const SANDBOX_START_TIMEOUT_SECONDS = 120;
const SANDBOX_START_POLL_MS = 1_000;
const DAYTONA_OPERATION_READY_TIMEOUT_MS = 30_000;
const DAYTONA_OPERATION_READY_POLL_MS = 2_000;
const DAYTONA_RATE_LIMIT_RETRY_BASE_MS = 1_000;
const DAYTONA_RATE_LIMIT_RETRY_MAX_MS = 10_000;
const SANDBOX_STARTED_CACHE_MS = 5_000;
const SANDBOX_RUNTIME_STATUS_CACHE_MS = 60_000;
const MAX_ENV_VALUE_LENGTH = 64 * 1024;
const MAX_BULK_ENV_COUNT = 50;
const MAX_BULK_ENV_VALUE_LENGTH = 512 * 1024;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMPUTER_USE_PROCESS_NAMES = ["xvfb", "xfce4", "x11vnc", "novnc"] as const;

interface EnsureProjectResult {
  projectId: string;
  reused: boolean;
  sandboxStatus: SandboxStatus;
  error?: string;
}

interface EnsuredProject {
  projectId: string;
  created: boolean;
  sandboxStatus: SandboxStatus;
}

interface DesktopPreviewResult {
  url: string;
  websocketUrl: string;
  port: number;
  expiresInSeconds: number;
}

interface TerminalPreviewResult {
  url: string;
  port: number;
  expiresInSeconds: number;
}

interface ThreadWorktreeResult {
  baseBranch: string;
  featureBranch: string;
  worktreePath: string;
  headSha: string;
  upstreamBranch?: string;
}

interface ThreadWorkspaceResult extends ThreadWorktreeResult {
  workspaceMode: ThreadWorkspaceMode;
}

interface ThreadWorktreeProvisioningResult {
  status: "provisioning";
  baseBranch: string;
  featureBranch: string;
  worktreePath: string;
}

type SandboxRuntimeStatus = "started" | "stopped" | "archived" | "unknown";

interface SandboxRuntimeStatusResult {
  status: SandboxRuntimeStatus;
  rawState?: string;
  checkedAt: number;
}

type ComputerUseProcessName = (typeof COMPUTER_USE_PROCESS_NAMES)[number];

type ComputerUseLifecycle = {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  getStatus(): Promise<unknown>;
  getProcessStatus?(processName: string): Promise<unknown>;
  restartProcess?(processName: string): Promise<unknown>;
  getProcessLogs?(processName: string): Promise<unknown>;
  getProcessErrors?(processName: string): Promise<unknown>;
};

const sandboxStartPromises = new Map<string, Promise<DaytonaSandbox>>();
const recentlyStartedSandboxes = new Map<string, { sandbox: DaytonaSandbox; expiresAt: number }>();

type ComputerUseDiagnostics = {
  processName: ComputerUseProcessName;
  status?: string;
  running?: boolean;
  errors?: string;
  logs?: string;
  diagnosticError?: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runSandboxShell(sandbox: DaytonaSandbox, command: string, allowFailure = false) {
  const sessionId = `thread-worktree-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await sandbox.process.createSession(sessionId);

  try {
    const result = await sandbox.process.executeSessionCommand(
      sessionId,
      { command, suppressInputEcho: true },
      120,
    );
    if (!allowFailure && typeof result.exitCode === "number" && result.exitCode !== 0) {
      throw new Error(sandboxCommandText(result) || "Sandbox Git command failed.");
    }
    return result;
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function repoNameFromUrl(repoUrl?: string): string | undefined {
  if (!repoUrl) {
    return undefined;
  }

  try {
    const url = new URL(repoUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    const segment = segments[segments.length - 1];
    return segment?.replace(/\.git$/i, "");
  } catch {
    const segments = repoUrl.split(/[/:]/).filter(Boolean);
    const segment = segments[segments.length - 1];
    return segment?.replace(/\.git$/i, "");
  }
}

function sandboxRepositoryDirectoryName(options: {
  repoName?: string;
  repoUrl?: string;
}): string {
  const candidate = options.repoName ?? repoNameFromUrl(options.repoUrl);

  if (!candidate?.trim()) {
    throw new Error("Repository name or URL is required to resolve the sandbox repository path.");
  }

  const cleaned = candidate
    .trim()
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);

  if (!cleaned) {
    throw new Error("Repository name resolved to an empty sandbox directory.");
  }

  return cleaned;
}

function sandboxRepositoryPath(sandboxWorkDir: string, repoDirectoryName: string): string {
  return `${sandboxWorkDir.replace(/\/+$/, "")}/${repoDirectoryName}`;
}

function isSandboxNotFoundError(error: unknown) {
  const message = errorMessage(error).toLowerCase();

  return message.includes("not found") || message.includes("404");
}

function isSandboxNetworkNotReadyError(error: unknown) {
  const message = errorMessage(error).toLowerCase();

  return (
    message.includes("failed to resolve container ip") ||
    message.includes("no ip address found") ||
    message.includes("is the sandbox started")
  );
}

function isSandboxStateChangeInProgressError(error: unknown) {
  return errorMessage(error).toLowerCase().includes("state change in progress");
}

function isDaytonaRateLimitError(error: unknown) {
  if (error instanceof Error && error.name === "DaytonaRateLimitError") return true;
  const message = errorMessage(error).toLowerCase();
  if (message.includes("too many requests") || message.includes("throttlerexception")) return true;
  if (!isRecord(error)) return false;
  return error.status === 429
    || error.status === "429"
    || error.statusCode === 429
    || error.statusCode === "429"
    || error.code === 429
    || error.code === "429";
}

function daytonaRateLimitRetryDelay(attempt: number) {
  return Math.min(
    DAYTONA_RATE_LIMIT_RETRY_BASE_MS * 2 ** Math.max(0, attempt),
    DAYTONA_RATE_LIMIT_RETRY_MAX_MS,
  );
}

async function retryDaytonaRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isDaytonaRateLimitError(error) || attempt >= 4) throw error;
      await sleep(daytonaRateLimitRetryDelay(attempt));
    }
  }
}

function createDaytonaClient() {
  const { Daytona } = daytonaSdk;
  return new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL,
  });
}

async function secureSandboxNetwork(sandbox: DaytonaSandbox) {
  const domainAllowList = sandboxDomainAllowList(process.env.DAYTONA_DOMAIN_ALLOW_LIST);
  if (sandbox.domainAllowList === domainAllowList) return sandbox;
  await sandbox.updateNetworkSettings({ domainAllowList });
  sandbox.domainAllowList = domainAllowList;
  return sandbox;
}

function validateSandboxEnvironmentInput(envName: string, value: string) {
  const normalizedEnvName = envName.trim();
  if (!ENV_NAME_PATTERN.test(normalizedEnvName) || normalizedEnvName.length > 128) {
    throw new ConvexError({
      code: "INVALID_ENV_NAME",
      message: "Variable names must start with a letter or underscore and contain only letters, numbers, and underscores.",
    });
  }
  if (!value || value.length > MAX_ENV_VALUE_LENGTH) {
    throw new ConvexError({
      code: "INVALID_ENV_VALUE",
      message: `Environment values must be between 1 and ${MAX_ENV_VALUE_LENGTH.toLocaleString()} characters.`,
    });
  }
  return { envName: normalizedEnvName };
}

async function deleteDaytonaSandbox(sandboxId: string) {
  const daytona = createDaytonaClient();
  const sandbox = await daytona.get(sandboxId);

  await daytona.delete(sandbox);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function desktopWebsocketUrl(value: string): string {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/websockify";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizePreviewUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === "http:") {
    url.protocol = "https:";
  }
  return url.toString().replace(/\/$/, "");
}

function computerUseStatus(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status;
  return typeof status === "string" ? status.toLowerCase() : undefined;
}

function compactDiagnostic(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;

  let raw: string;
  try {
    raw = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    raw = String(value);
  }

  const normalized = raw.trim().replace(/\s+/g, " ");
  return normalized.length > MAX_DESKTOP_DIAGNOSTIC_LENGTH
    ? `${normalized.slice(0, MAX_DESKTOP_DIAGNOSTIC_LENGTH)}...`
    : normalized;
}

function responseField(value: unknown, field: string): unknown {
  return isRecord(value) ? value[field] : undefined;
}

function computerUseProcessNamesFromError(error: unknown): ComputerUseProcessName[] {
  const message = errorMessage(error).toLowerCase();
  const matched = COMPUTER_USE_PROCESS_NAMES.filter((processName) => message.includes(processName));
  return matched.length > 0 ? matched : [...COMPUTER_USE_PROCESS_NAMES];
}

async function readComputerUseStatus(computerUse: Pick<ComputerUseLifecycle, "getStatus">): Promise<string | undefined> {
  try {
    return computerUseStatus(await computerUse.getStatus());
  } catch {
    return undefined;
  }
}

function normalizeSandboxRuntimeStatus(state: unknown): SandboxRuntimeStatus {
  if (typeof state !== "string") return "unknown";
  const normalized = state.toLowerCase();
  if (normalized === "started" || normalized === "running") return "started";
  if (normalized === "archived") return "archived";
  if (normalized === "stopped" || normalized === "stopping") return "stopped";
  return "unknown";
}

async function getDaytonaSandboxRuntimeStatus(sandboxId: string): Promise<SandboxRuntimeStatusResult> {
  const daytona = createDaytonaClient();
  const sandbox = await daytona.get(sandboxId);
  const rawState = typeof sandbox.state === "string" ? sandbox.state : undefined;

  return {
    status: normalizeSandboxRuntimeStatus(rawState),
    rawState,
    checkedAt: Date.now(),
  };
}

async function waitForDesktopReady(computerUse: Pick<ComputerUseLifecycle, "getStatus">): Promise<void> {
  const deadline = Date.now() + DESKTOP_STATUS_TIMEOUT_MS;
  let lastStatus: string | undefined;

  while (Date.now() < deadline) {
    lastStatus = computerUseStatus(await computerUse.getStatus());
    if (lastStatus === "active") return;
    await sleep(DESKTOP_STATUS_POLL_MS);
  }

  throw new Error(`VNC desktop not ready${lastStatus ? `: ${lastStatus}` : ""}.`);
}

async function restartComputerUseProcesses(
  computerUse: ComputerUseLifecycle,
  processNames: ComputerUseProcessName[],
  errors: unknown[],
) {
  if (!computerUse.restartProcess) {
    errors.push(new Error("Daytona SDK does not expose computerUse.restartProcess."));
    return;
  }

  for (const processName of processNames) {
    try {
      await computerUse.restartProcess(processName);
    } catch (error) {
      errors.push(new Error(`restart ${processName}: ${errorMessage(error)}`));
    }
  }
}

async function collectComputerUseDiagnostics(
  computerUse: ComputerUseLifecycle,
  processNames: ComputerUseProcessName[],
): Promise<ComputerUseDiagnostics[]> {
  const diagnostics: ComputerUseDiagnostics[] = [];

  for (const processName of processNames) {
    const diagnostic: ComputerUseDiagnostics = { processName };

    try {
      const status = await computerUse.getProcessStatus?.(processName);
      const running = responseField(status, "running");
      const processStatus = responseField(status, "status");
      diagnostic.running = typeof running === "boolean" ? running : undefined;
      diagnostic.status = typeof processStatus === "string" ? processStatus : undefined;
    } catch (error) {
      diagnostic.diagnosticError = compactDiagnostic(`status: ${errorMessage(error)}`);
    }

    try {
      const errors = await computerUse.getProcessErrors?.(processName);
      diagnostic.errors = compactDiagnostic(responseField(errors, "errors"));
    } catch (error) {
      diagnostic.diagnosticError = compactDiagnostic(
        [diagnostic.diagnosticError, `errors: ${errorMessage(error)}`].filter(Boolean).join("; "),
      );
    }

    if (!diagnostic.errors) {
      try {
        const logs = await computerUse.getProcessLogs?.(processName);
        diagnostic.logs = compactDiagnostic(responseField(logs, "logs"));
      } catch (error) {
        diagnostic.diagnosticError = compactDiagnostic(
          [diagnostic.diagnosticError, `logs: ${errorMessage(error)}`].filter(Boolean).join("; "),
        );
      }
    }

    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

function formatComputerUseFailure(errors: unknown[], diagnostics: ComputerUseDiagnostics[]) {
  const attempts = Array.from(new Set(errors.map(errorMessage).filter(Boolean))).slice(0, 4);
  const processDetails = diagnostics
    .map((diagnostic) => {
      const parts = [
        diagnostic.processName,
        diagnostic.running === undefined ? undefined : `running=${diagnostic.running}`,
        diagnostic.status ? `status=${diagnostic.status}` : undefined,
        diagnostic.errors ? `errors=${diagnostic.errors}` : undefined,
        !diagnostic.errors && diagnostic.logs ? `logs=${diagnostic.logs}` : undefined,
        diagnostic.diagnosticError ? `diagnostic=${diagnostic.diagnosticError}` : undefined,
      ].filter(Boolean);
      return parts.join(" ");
    })
    .join("; ");

  return [
    "Failed to start Daytona desktop after recovery.",
    attempts.length > 0 ? `attempts: ${attempts.join(" | ")}` : undefined,
    processDetails ? `processes: ${processDetails}` : undefined,
  ].filter(Boolean).join(" ");
}

async function recoverComputerUse(computerUse: ComputerUseLifecycle, cause: unknown) {
  const errors: unknown[] = [cause];
  const processNames = computerUseProcessNamesFromError(cause);

  await computerUse.stop().catch((error) => {
    errors.push(new Error(`stop: ${errorMessage(error)}`));
  });
  await sleep(DESKTOP_RECOVERY_DELAY_MS);

  try {
    await computerUse.start();
  } catch (error) {
    errors.push(error);
    await restartComputerUseProcesses(computerUse, processNames, errors);
  }

  try {
    await waitForDesktopReady(computerUse);
  } catch (error) {
    errors.push(error);
    const diagnostics = await collectComputerUseDiagnostics(computerUse, processNames);
    throw new Error(formatComputerUseFailure(errors, diagnostics));
  }
}

async function ensureDesktopReady(computerUse: ComputerUseLifecycle) {
  const currentStatus = await readComputerUseStatus(computerUse);

  if (currentStatus === "active") {
    return;
  }

  if (currentStatus === "partial" || currentStatus === "error") {
    await recoverComputerUse(computerUse, new Error(`VNC desktop status is ${currentStatus}.`));
    return;
  }

  try {
    await computerUse.start();
  } catch (error) {
    if (await readComputerUseStatus(computerUse) === "active") {
      return;
    }
    await recoverComputerUse(computerUse, error);
    return;
  }

  try {
    await waitForDesktopReady(computerUse);
  } catch (error) {
    await recoverComputerUse(computerUse, error);
  }
}

async function ensureSandboxStartedUncoalesced(sandboxId: string) {
  const daytona = createDaytonaClient();
  const deadline = Date.now() + SANDBOX_START_TIMEOUT_SECONDS * 1000;
  let lastError: unknown;
  let rateLimitAttempt = 0;

  while (Date.now() <= deadline) {
    try {
      const sandbox = await daytona.get(sandboxId);

      if (!sandbox.state || normalizeSandboxRuntimeStatus(sandbox.state) === "started") {
        return secureSandboxNetwork(sandbox);
      }

      if (sandbox.domainAllowList !== sandboxDomainAllowList(process.env.DAYTONA_DOMAIN_ALLOW_LIST)) {
        throw new Error(
          "Refusing to start a sandbox whose network policy is missing or outdated. Recreate the sandbox to apply the configured domain allow-list before startup.",
        );
      }

      const timeoutSeconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
      await sandbox.start(timeoutSeconds);
      return secureSandboxNetwork(sandbox);
    } catch (error) {
      lastError = error;
      if (isSandboxStateChangeInProgressError(error)) {
        await sleep(SANDBOX_START_POLL_MS);
        continue;
      }
      if (isDaytonaRateLimitError(error) && Date.now() < deadline) {
        await sleep(daytonaRateLimitRetryDelay(rateLimitAttempt));
        rateLimitAttempt += 1;
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Sandbox did not become ready before the timeout.");
}

async function ensureSandboxStarted(sandboxId: string): Promise<DaytonaSandbox> {
  const cached = recentlyStartedSandboxes.get(sandboxId);
  if (cached && cached.expiresAt > Date.now()) return cached.sandbox;
  if (cached) recentlyStartedSandboxes.delete(sandboxId);

  const existing = sandboxStartPromises.get(sandboxId);
  if (existing) return await existing;

  const pending = ensureSandboxStartedUncoalesced(sandboxId);
  sandboxStartPromises.set(sandboxId, pending);

  try {
    const sandbox = await pending;
    recentlyStartedSandboxes.set(sandboxId, {
      sandbox,
      expiresAt: Date.now() + SANDBOX_STARTED_CACHE_MS,
    });
    return sandbox;
  } finally {
    if (sandboxStartPromises.get(sandboxId) === pending) {
      sandboxStartPromises.delete(sandboxId);
    }
  }
}

async function startDaytonaSandbox(sandboxId: string) {
  await ensureSandboxStarted(sandboxId);
  return "started" as const;
}

async function runWithStartedSandboxRetry<T>(
  sandboxId: string,
  operation: (sandbox: DaytonaSandbox) => Promise<T>,
): Promise<T> {
  let sandbox = await ensureSandboxStarted(sandboxId);
  const deadline = Date.now() + DAYTONA_OPERATION_READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      return await operation(sandbox);
    } catch (error) {
      if (!isSandboxNetworkNotReadyError(error) && !isSandboxStateChangeInProgressError(error)) {
        throw error;
      }
      lastError = error;
      await sleep(DAYTONA_OPERATION_READY_POLL_MS);
      sandbox = await ensureSandboxStarted(sandboxId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Sandbox did not become ready for this operation.");
}

async function stopDaytonaSandbox(sandboxId: string) {
  const pendingStart = sandboxStartPromises.get(sandboxId);
  if (pendingStart) await pendingStart.catch(() => undefined);
  const daytona = createDaytonaClient();
  const sandbox = await daytona.get(sandboxId);

  if (sandbox.state && normalizeSandboxRuntimeStatus(sandbox.state) !== "stopped") {
    await sandbox.stop();
  }

  recentlyStartedSandboxes.delete(sandboxId);

  return "stopped" as const;
}

async function getDaytonaDesktopPreview(sandboxId: string): Promise<DesktopPreviewResult> {
  return runWithStartedSandboxRetry(sandboxId, async (sandbox) => {
    await ensureDesktopReady(sandbox.computerUse);

    const preview = await sandbox.getSignedPreviewUrl(DAYTONA_NOVNC_PORT, DESKTOP_PREVIEW_EXPIRES_SECONDS);
    const url = normalizePreviewUrl(preview.url);

    return {
      url,
      websocketUrl: desktopWebsocketUrl(url),
      port: DAYTONA_NOVNC_PORT,
      expiresInSeconds: DESKTOP_PREVIEW_EXPIRES_SECONDS,
    };
  });
}

async function startIsolatedTerminalPreview(sandbox: DaytonaSandbox, workDir: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < TERMINAL_PORT_ATTEMPTS; attempt += 1) {
    const port = TERMINAL_PORT_MIN + Math.floor(Math.random() * TERMINAL_PORT_SPAN);
    const result = await sandbox.process.executeCommand(
      `set -eu
test -d ${shellQuote(workDir)}
command -v lsof >/dev/null
command -v timeout >/dev/null
ttyd_path="$(command -v ttyd || true)"
if [ -z "$ttyd_path" ]; then
  architecture="$(uname -m)"
  case "$architecture" in
    aarch64|x86_64) ;;
    *) printf 'Unsupported ttyd architecture: %s\\n' "$architecture" >&2; exit 1 ;;
  esac
  ttyd_path="$HOME/.local/bin/ttyd"
  if [ ! -x "$ttyd_path" ]; then
    mkdir -p "$HOME/.local/bin"
    ttyd_download="$(mktemp "$HOME/.local/bin/.ttyd.XXXXXX")"
    trap 'rm -f "$ttyd_download"' EXIT
    curl -fsSL \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.$architecture" \
      -o "$ttyd_download"
    case "$architecture" in
      aarch64) ttyd_checksum=${TTYD_SHA256.aarch64} ;;
      x86_64) ttyd_checksum=${TTYD_SHA256.x86_64} ;;
    esac
    printf '%s  %s\\n' "$ttyd_checksum" "$ttyd_download" | sha256sum -c - >/dev/null
    chmod 0755 "$ttyd_download"
    mv "$ttyd_download" "$ttyd_path"
    trap - EXIT
  fi
fi
shell_path="$(command -v zsh)"
if lsof -nP -iTCP:${port} -sTCP:LISTEN -t | grep -q .; then
  exit 42
fi
terminal_log="/tmp/autopr-terminal-${port}.log"
nohup timeout ${TERMINAL_PROCESS_TIMEOUT_MINUTES}m "$ttyd_path" \
  --port ${port} \
  --writable \
  --once \
  --cwd ${shellQuote(workDir)} \
  "$shell_path" -l \
  </dev/null >"$terminal_log" 2>&1 &
terminal_pid=$!
for readiness_attempt in $(seq 1 50); do
  if lsof -nP -iTCP:${port} -sTCP:LISTEN -t | grep -q .; then
    printf 'AUTOPR_TERMINAL_PORT=%s\\n' ${port}
    exit 0
  fi
  if ! kill -0 "$terminal_pid" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
kill "$terminal_pid" >/dev/null 2>&1 || true
cat "$terminal_log" >&2 || true
exit 1`,
      "/",
      undefined,
      20,
    );

    if (result.exitCode === 0) {
      return port;
    }
    if (result.exitCode !== 42) {
      lastError = new Error(sandboxCommandText(result) || "Could not start the isolated terminal.");
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not allocate an isolated terminal port.");
}

async function resolveThreadTerminalWorkingDirectory(
  ctx: ActionCtx,
  authorId: string,
  projectId: string,
  threadId: string,
) {
  const { project, thread } = await ctx.runQuery(internal.threads.getWorktreeContextInternal, {
    authorId,
    projectId,
    threadId,
  });

  if (resolveThreadWorkspaceMode(thread) === "checkout") {
    return project.sandboxWorkDir ?? sandboxRepositoryPath(
      DEFAULT_SANDBOX_WORKDIR,
      sandboxRepositoryDirectoryName({ repoName: project.repoName, repoUrl: project.cloneUrl }),
    );
  }

  const provisioned = await provisionThreadWorktree(ctx, authorId, projectId, threadId);
  if ("status" in provisioned) {
    throw new ConvexError({
      code: "THREAD_WORKTREE_PROVISIONING",
      message: "The thread workspace is still being prepared. Try again shortly.",
    });
  }
  return provisioned.worktreePath;
}

async function getDaytonaTerminalPreview(
  sandboxId: string,
  workDir: string,
): Promise<TerminalPreviewResult> {
  return runWithStartedSandboxRetry(sandboxId, async (sandbox) => {
    const port = await startIsolatedTerminalPreview(sandbox, workDir);
    const preview = await sandbox.getSignedPreviewUrl(
      port,
      TERMINAL_PREVIEW_EXPIRES_SECONDS,
    );

    return {
      url: normalizePreviewUrl(preview.url),
      port,
      expiresInSeconds: TERMINAL_PREVIEW_EXPIRES_SECONDS,
    };
  });
}

async function bootstrapRepositorySandbox(options: {
  cacheKey: string;
  repoUrl: string;
  repoBranch?: string;
  repoName?: string;
  snapshot?: string;
}) {
  const daytona = createDaytonaClient();
  const sandbox = await daytona.create({
    name: autoprSandboxName(options.cacheKey),
    labels: autoprSandboxLabels(options.cacheKey),
    snapshot: options.snapshot ?? process.env.DAYTONA_SNAPSHOT ?? DEFAULT_DAYTONA_SNAPSHOT,
    autoStopInterval: SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
    autoArchiveInterval: SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES,
    domainAllowList: sandboxDomainAllowList(process.env.DAYTONA_DOMAIN_ALLOW_LIST),
  });
  const repoDir = sandboxRepositoryDirectoryName({
    repoName: options.repoName,
    repoUrl: options.repoUrl,
  });
  const repoPath = sandboxRepositoryPath(DEFAULT_SANDBOX_WORKDIR, repoDir);

  try {
    await sandbox.git.status(repoPath);
  } catch {
    await sandbox.git.clone(options.repoUrl, repoPath, options.repoBranch);
  }

  return {
    sandboxId: sandbox.id,
    sandboxName: sandbox.name,
    sandboxSnapshot: sandbox.snapshot,
    sandboxWorkDir: repoPath,
  };
}

async function readThreadWorktreeState(
  sandbox: DaytonaSandbox,
  repositoryPath: string,
  featureBranch: string,
) {
  const quotedRepositoryPath = shellQuote(repositoryPath);
  await runSandboxShell(sandbox, `git -C ${quotedRepositoryPath} worktree prune`);
  const list = sandboxCommandText(
    await runSandboxShell(sandbox, `git -C ${quotedRepositoryPath} worktree list --porcelain`),
  );
  const branchCheck = await runSandboxShell(
    sandbox,
    `git -C ${quotedRepositoryPath} show-ref --verify --quiet ${shellQuote(`refs/heads/${featureBranch}`)}`,
    true,
  );

  return {
    entries: parseGitWorktreeList(list),
    branchExists: branchCheck.exitCode === 0,
  };
}

async function provisionThreadWorktree(
  ctx: ActionCtx,
  authorId: string,
  projectId: string,
  threadId: string,
): Promise<ThreadWorktreeResult | ThreadWorktreeProvisioningResult> {
  const { project, thread } = await ctx.runQuery(internal.threads.getWorktreeContextInternal, {
    authorId,
    projectId,
    threadId,
  });

  if (resolveThreadWorkspaceMode(thread) !== "worktree") {
    throw new ConvexError({ code: "THREAD_WORKTREE_NOT_ENABLED" });
  }

  if (project.sandboxStatus !== "ready" || !project.sandboxId) {
    throw new ConvexError({ code: "PROJECT_NOT_READY" });
  }

  if (
    thread.worktreeStatus === "ready"
    && thread.baseBranch
    && thread.featureBranch
    && thread.worktreePath
    && thread.headSha
  ) {
    return {
      baseBranch: thread.baseBranch,
      featureBranch: thread.featureBranch,
      worktreePath: thread.worktreePath,
      headSha: thread.headSha,
      upstreamBranch: thread.upstreamBranch,
    };
  }

  const repositoryPath = project.sandboxWorkDir ?? sandboxRepositoryPath(
    DEFAULT_SANDBOX_WORKDIR,
    sandboxRepositoryDirectoryName({ repoName: project.repoName, repoUrl: project.cloneUrl }),
  );
  const baseBranch = resolveThreadBaseBranch(thread, project);
  if (!baseBranch) {
    throw new ConvexError({ code: "THREAD_BASE_BRANCH_UNKNOWN" });
  }
  const featureBranch = thread.featureBranch ?? createThreadFeatureBranch(thread.title, thread.threadId);
  const expectedWorktreePath = createThreadWorktreePath(
    repositoryPath,
    project.repoName,
    thread.threadId,
  );
  const worktreePath = thread.worktreePath ?? expectedWorktreePath;
  if (worktreePath !== expectedWorktreePath) {
    throw new ConvexError({ code: "THREAD_WORKTREE_PATH_UNSAFE" });
  }

  const attemptId = `worktree:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
  const reservation = await ctx.runMutation(internal.threads.reserveWorktreeInternal, {
    authorId,
    threadId,
    baseBranch,
    featureBranch,
    worktreePath,
    attemptId,
  });

  if (!reservation.acquired) {
    return { status: "provisioning", baseBranch, featureBranch, worktreePath };
  }

  try {
    const sandbox = await ensureSandboxStarted(project.sandboxId);
    let state = await readThreadWorktreeState(sandbox, repositoryPath, featureBranch);
    let decision = decideWorktreeProvision({
      entries: state.entries,
      desiredPath: worktreePath,
      featureBranch,
      branchExists: state.branchExists,
    });

    if (decision.kind === "conflict") {
      throw new Error(decision.message);
    }

    if (decision.kind !== "ready") {
      const pathCheck = await runSandboxShell(sandbox, `test -e ${shellQuote(worktreePath)}`, true);
      if (pathCheck.exitCode === 0) {
        throw new Error(`The thread worktree path already exists but is not registered with Git: ${worktreePath}`);
      }

      await runSandboxShell(sandbox, `mkdir -p ${shellQuote(worktreePath.slice(0, worktreePath.lastIndexOf("/")))}`);
      const quotedRepositoryPath = shellQuote(repositoryPath);
      const creationPoint = thread.githubPullRequestHeadSha ?? baseBranch;
      if (decision.kind === "create-branch-and-worktree" && thread.githubPullRequestHeadSha) {
        const objectCheck = await runSandboxShell(
          sandbox,
          `git -C ${quotedRepositoryPath} cat-file -e ${shellQuote(`${thread.githubPullRequestHeadSha}^{commit}`)}`,
          true,
        );
        if (objectCheck.exitCode !== 0) {
          throw new Error("The pull request commit is no longer available locally. Re-open the PR from GitHub to fetch it again.");
        }
      }
      const addCommand = decision.kind === "create-from-existing-branch"
        ? `git -C ${quotedRepositoryPath} worktree add ${shellQuote(worktreePath)} ${shellQuote(featureBranch)}`
        : `git -C ${quotedRepositoryPath} worktree add -b ${shellQuote(featureBranch)} ${shellQuote(worktreePath)} ${shellQuote(creationPoint)}`;

      try {
        await runSandboxShell(sandbox, addCommand);
      } catch (error) {
        // Concurrent retries can race after both inspect the same state. Re-read
        // Git's authoritative worktree registry before deciding the retry failed.
        state = await readThreadWorktreeState(sandbox, repositoryPath, featureBranch);
        decision = decideWorktreeProvision({
          entries: state.entries,
          desiredPath: worktreePath,
          featureBranch,
          branchExists: state.branchExists,
        });
        if (decision.kind !== "ready") throw error;
      }
    }

    const quotedWorktreePath = shellQuote(worktreePath);
    const headSha = sandboxCommandText(
      await runSandboxShell(sandbox, `git -C ${quotedWorktreePath} rev-parse HEAD`),
    );
    const upstreamResult = await runSandboxShell(
      sandbox,
      `git -C ${quotedWorktreePath} rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'`,
      true,
    );
    const upstreamBranch = upstreamResult.exitCode === 0
      ? sandboxCommandText(upstreamResult) || undefined
      : undefined;

    const markedReady = await ctx.runMutation(internal.threads.markWorktreeReadyInternal, {
      authorId,
      threadId,
      attemptId,
      worktreePath,
      headSha,
      upstreamBranch,
    });
    if (!markedReady) {
      throw new Error("A newer worktree provisioning attempt replaced this one.");
    }

    return { baseBranch, featureBranch, worktreePath, headSha, upstreamBranch };
  } catch (error) {
    await ctx.runMutation(internal.threads.markWorktreeFailedInternal, {
      authorId,
      threadId,
      attemptId,
      error: errorMessage(error),
    }).catch(() => undefined);
    throw new ConvexError({
      code: "THREAD_WORKTREE_PROVISION_FAILED",
      message: errorMessage(error),
    });
  }
}

export const ensureThreadWorktree = action({
  args: { projectId: v.string(), threadId: v.string() },
  returns: v.union(
    v.object({
      baseBranch: v.string(),
      featureBranch: v.string(),
      worktreePath: v.string(),
      headSha: v.string(),
      upstreamBranch: v.optional(v.string()),
    }),
    v.object({
      status: v.literal("provisioning"),
      baseBranch: v.string(),
      featureBranch: v.string(),
      worktreePath: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<ThreadWorktreeResult | ThreadWorktreeProvisioningResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHORIZED" });
    return await provisionThreadWorktree(ctx, identity.subject, args.projectId, args.threadId);
  },
});

async function resolveThreadWorkspaceForAuthor(
  ctx: ActionCtx,
  authorId: string,
  projectId: string,
  threadId: string,
): Promise<ThreadWorkspaceResult> {
  const { project, thread } = await ctx.runQuery(internal.threads.getWorktreeContextInternal, {
    authorId,
    projectId,
    threadId,
  });
  const workspaceMode = resolveThreadWorkspaceMode(thread);

  if (workspaceMode === "worktree") {
    const provisioned = await provisionThreadWorktree(ctx, authorId, projectId, threadId);
    if ("status" in provisioned) {
      throw new ConvexError({
        code: "THREAD_WORKTREE_PROVISIONING",
        message: "The thread workspace is still being prepared. Try again shortly.",
      });
    }
    return {
      workspaceMode,
      ...provisioned,
    };
  }

  if (project.sandboxStatus !== "ready" || !project.sandboxId) {
    throw new ConvexError({ code: "PROJECT_NOT_READY" });
  }

  const repositoryPath = project.sandboxWorkDir ?? sandboxRepositoryPath(
    DEFAULT_SANDBOX_WORKDIR,
    sandboxRepositoryDirectoryName({ repoName: project.repoName, repoUrl: project.cloneUrl }),
  );
  const sandbox = await ensureSandboxStarted(project.sandboxId);
  const quotedRepositoryPath = shellQuote(repositoryPath);
  const featureBranch = sandboxCommandText(
    await runSandboxShell(sandbox, `git -C ${quotedRepositoryPath} branch --show-current`),
  );
  if (!featureBranch) {
    throw new ConvexError({
      code: "PROJECT_CHECKOUT_DETACHED",
      message: "The project checkout is detached. Check out a branch before running this thread.",
    });
  }

  const headSha = sandboxCommandText(
    await runSandboxShell(sandbox, `git -C ${quotedRepositoryPath} rev-parse HEAD`),
  );
  const upstreamResult = await runSandboxShell(
    sandbox,
    `git -C ${quotedRepositoryPath} rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'`,
    true,
  );
  const upstreamBranch = upstreamResult.exitCode === 0
    ? sandboxCommandText(upstreamResult) || undefined
    : undefined;

  return {
    workspaceMode,
    baseBranch: project.defaultBranch ?? thread.baseBranch ?? featureBranch,
    featureBranch,
    worktreePath: repositoryPath,
    headSha,
    upstreamBranch,
  };
}

export const resolveThreadWorkspace = action({
  args: { projectId: v.string(), threadId: v.string() },
  returns: v.object({
    workspaceMode: v.union(v.literal("checkout"), v.literal("worktree")),
    baseBranch: v.string(),
    featureBranch: v.string(),
    worktreePath: v.string(),
    headSha: v.string(),
    upstreamBranch: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<ThreadWorkspaceResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHORIZED" });
    return await resolveThreadWorkspaceForAuthor(
      ctx,
      identity.subject,
      args.projectId,
      args.threadId,
    );
  },
});

async function cleanupThreadWorktreeForAuthor(
  ctx: ActionCtx,
  authorId: string,
  args: { projectId: string; threadId: string },
): Promise<{ removed: boolean; branchPreserved: true }> {
  const { project, thread } = await ctx.runQuery(internal.threads.getWorktreeContextInternal, {
    authorId,
    projectId: args.projectId,
    threadId: args.threadId,
  });

  if (resolveThreadWorkspaceMode(thread) === "checkout") {
    return { removed: false, branchPreserved: true };
  }

  if (!thread.worktreePath || !project.sandboxId) {
    await ctx.runMutation(internal.threads.markWorktreeCleanedInternal, {
      authorId,
      threadId: args.threadId,
    });
    return { removed: false, branchPreserved: true };
  }

  const sandbox = await ensureSandboxStarted(project.sandboxId);
  const repositoryPath = project.sandboxWorkDir ?? sandboxRepositoryPath(
    DEFAULT_SANDBOX_WORKDIR,
    sandboxRepositoryDirectoryName({ repoName: project.repoName, repoUrl: project.cloneUrl }),
  );
  const expectedWorktreePath = createThreadWorktreePath(
    repositoryPath,
    project.repoName,
    thread.threadId,
  );
  if (thread.worktreePath !== expectedWorktreePath) {
    throw new ConvexError({ code: "THREAD_WORKTREE_PATH_UNSAFE" });
  }
  const state = await readThreadWorktreeState(
    sandbox,
    repositoryPath,
    thread.featureBranch ?? "",
  );
  const registered = state.entries.find((entry) => entry.path === thread.worktreePath);

  if (!registered) {
    await ctx.runMutation(internal.threads.markWorktreeCleanedInternal, {
      authorId,
      threadId: args.threadId,
    });
    return { removed: false, branchPreserved: true };
  }

  const status = sandboxCommandText(
    await runSandboxShell(sandbox, `git -C ${shellQuote(thread.worktreePath)} status --porcelain`),
  );
  const cleanup = assessWorktreeCleanup(status);
  if (!cleanup.canRemoveWorktree) {
    throw new ConvexError({ code: "THREAD_WORKTREE_DIRTY", message: cleanup.reason });
  }

  await runSandboxShell(
    sandbox,
    `git -C ${shellQuote(repositoryPath)} worktree remove ${shellQuote(thread.worktreePath)}`,
  );
  // Deliberately retain the feature branch. A clean worktree can still contain
  // local commits that have not reached an upstream remote.
  await ctx.runMutation(internal.threads.markWorktreeCleanedInternal, {
    authorId,
    threadId: args.threadId,
  });
  return { removed: true, branchPreserved: true };
}

export const cleanupThreadWorktree = action({
  args: { projectId: v.string(), threadId: v.string() },
  returns: v.object({ removed: v.boolean(), branchPreserved: v.literal(true) }),
  handler: async (ctx, args): Promise<{ removed: boolean; branchPreserved: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHORIZED" });
    return await cleanupThreadWorktreeForAuthor(ctx, identity.subject, args);
  },
});

export const removeThreadWithWorktree = action({
  args: { projectId: v.string(), threadId: v.string() },
  returns: v.object({ projectId: v.string(), threadId: v.string(), branchPreserved: v.literal(true) }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHORIZED" });
    const cleanup = await cleanupThreadWorktreeForAuthor(ctx, identity.subject, args);
    await ctx.runMutation(internal.threads.removeInternal, {
      authorId: identity.subject,
      threadId: args.threadId,
    });
    return {
      projectId: args.projectId,
      threadId: args.threadId,
      branchPreserved: cleanup.branchPreserved,
    };
  },
});

export const getSandboxRuntimeStatus = action({
  args: {
    projectId: v.string(),
    forceRefresh: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(v.literal("started"), v.literal("stopped"), v.literal("archived"), v.literal("unknown")),
    rawState: v.optional(v.string()),
    checkedAt: v.number(),
  }),
  handler: async (ctx, args): Promise<SandboxRuntimeStatusResult> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project: { sandboxId: string; sandboxRuntimeStatus?: SandboxRuntimeStatus; sandboxRuntimeCheckedAt?: number } =
      await ctx.runQuery(internal.projects.getDesktopSandboxInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
      });

    const now = Date.now();
    if (
      !args.forceRefresh &&
      project.sandboxRuntimeStatus &&
      project.sandboxRuntimeCheckedAt &&
      now - project.sandboxRuntimeCheckedAt < SANDBOX_RUNTIME_STATUS_CACHE_MS
    ) {
      return {
        status: project.sandboxRuntimeStatus,
        checkedAt: project.sandboxRuntimeCheckedAt,
      };
    }

    try {
      const status = await getDaytonaSandboxRuntimeStatus(project.sandboxId);
      await ctx.runMutation(internal.projects.updateSandboxRuntimeStatusInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        sandboxRuntimeStatus: status.status,
      });
      return status;
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_SANDBOX_STATUS_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const startSandbox = action({
  args: {
    projectId: v.string(),
  },
  returns: v.object({
    status: v.union(v.literal("started"), v.literal("stopped"), v.literal("archived"), v.literal("unknown")),
  }),
  handler: async (ctx, args): Promise<{ status: SandboxRuntimeStatus }> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project: { sandboxId: string } = await ctx.runQuery(internal.projects.getDesktopSandboxInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });

    try {
      const status = await startDaytonaSandbox(project.sandboxId);
      await ctx.runMutation(internal.projects.updateSandboxRuntimeStatusInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        sandboxRuntimeStatus: status,
      });
      await ctx.runMutation(internal.threads.invalidateProjectGitStatusesInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        reason: "sandbox_reconnect",
      });
      return { status };
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_SANDBOX_START_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const stopSandbox = action({
  args: {
    projectId: v.string(),
  },
  returns: v.object({
    status: v.literal("stopped"),
  }),
  handler: async (ctx, args): Promise<{ status: "stopped" }> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project: { sandboxId: string } = await ctx.runQuery(internal.projects.getDesktopSandboxInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });

    try {
      const status = await stopDaytonaSandbox(project.sandboxId);
      await ctx.runMutation(internal.projects.updateSandboxRuntimeStatusInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        sandboxRuntimeStatus: status,
      });
      return { status };
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_SANDBOX_STOP_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const getDesktopPreview = action({
  args: {
    projectId: v.string(),
  },
  returns: v.object({
    url: v.string(),
    websocketUrl: v.string(),
    port: v.number(),
    expiresInSeconds: v.number(),
  }),
  handler: async (ctx, args): Promise<DesktopPreviewResult> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project: { sandboxId: string } = await ctx.runQuery(internal.projects.getDesktopSandboxInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });

    try {
      const preview = await getDaytonaDesktopPreview(project.sandboxId);
      await ctx.runMutation(internal.projects.updateSandboxRuntimeStatusInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        sandboxRuntimeStatus: "started",
      });
      return preview;
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_DESKTOP_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const getTerminalPreview = action({
  args: {
    projectId: v.string(),
    threadId: v.optional(v.string()),
  },
  returns: v.object({
    url: v.string(),
    port: v.number(),
    expiresInSeconds: v.number(),
  }),
  handler: async (ctx, args): Promise<TerminalPreviewResult> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project: { sandboxId: string; sandboxWorkDir?: string } = await ctx.runQuery(
      internal.projects.getDesktopSandboxInternal,
      {
        authorId: identity.subject,
        projectId: args.projectId,
      },
    );

    try {
      const workDir = args.threadId
        ? await resolveThreadTerminalWorkingDirectory(
            ctx,
            identity.subject,
            args.projectId,
            args.threadId,
          )
        : project.sandboxWorkDir;
      const preview = await getDaytonaTerminalPreview(
        project.sandboxId,
        workDir ?? DEFAULT_SANDBOX_WORKDIR,
      );
      await ctx.runMutation(internal.projects.updateSandboxRuntimeStatusInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        sandboxRuntimeStatus: "started",
      });
      return preview;
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_TERMINAL_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const importSandboxEnvironmentVariables = action({
  args: {
    projectId: v.string(),
    entries: v.array(v.object({
      envName: v.string(),
      value: v.string(),
    })),
  },
  returns: v.object({
    importedCount: v.number(),
    restarted: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ importedCount: number; restarted: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }
    if (args.entries.length === 0 || args.entries.length > MAX_BULK_ENV_COUNT) {
      throw new ConvexError({
        code: "INVALID_BULK_SECRET_COUNT",
        message: `Import between 1 and ${MAX_BULK_ENV_COUNT} variables at a time.`,
      });
    }
    if (args.entries.reduce((length, entry) => length + entry.value.length, 0) > MAX_BULK_ENV_VALUE_LENGTH) {
      throw new ConvexError({
        code: "BULK_SECRET_VALUES_TOO_LARGE",
        message: "The pasted environment file is too large to import at once.",
      });
    }

    const normalizedEntries = args.entries.map((entry) => {
      const validated = validateSandboxEnvironmentInput(entry.envName, entry.value);
      return { envName: validated.envName, value: entry.value };
    });
    if (new Set(normalizedEntries.map((entry) => entry.envName)).size !== normalizedEntries.length) {
      throw new ConvexError({ code: "DUPLICATE_ENV_NAMES", message: "Each imported variable name must be unique." });
    }

    const project = await ctx.runQuery(internal.projects.getSandboxEnvironmentInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });
    const importedNames = new Set(normalizedEntries.map((entry) => entry.envName));
    const legacySecretsToReplace = project.sandboxSecrets.filter((secret) => importedNames.has(secret.envName));
    let environmentUpdated = false;

    try {
      const sandbox = await ensureSandboxStarted(project.sandboxId);
      if (legacySecretsToReplace.length > 0) {
        await sandbox.updateSecrets(Object.fromEntries(
          project.sandboxSecrets
            .filter((secret) => !importedNames.has(secret.envName))
            .map((secret) => [secret.envName, secret.secretName]),
        ));
      }
      await sandbox.updateEnv(Object.fromEntries(
        normalizedEntries.map((entry) => [entry.envName, entry.value]),
      ));
      environmentUpdated = true;

      await ctx.runMutation(internal.projects.upsertSandboxEnvironmentVariablesInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        variables: normalizedEntries.map((entry) => ({
          envName: entry.envName,
          updatedAt: Date.now(),
        })),
      });

      const daytona = createDaytonaClient();
      for (const secret of legacySecretsToReplace) {
        await daytona.secret.delete(secret.secretId).catch(() => undefined);
      }
      return { importedCount: normalizedEntries.length, restarted: false };
    } catch (error) {
      if (!environmentUpdated && legacySecretsToReplace.length > 0) {
        const sandbox = await createDaytonaClient().get(project.sandboxId).catch(() => undefined);
        await sandbox?.updateSecrets(Object.fromEntries(
          project.sandboxSecrets.map((secret) => [secret.envName, secret.secretName]),
        )).catch(() => undefined);
      }
      if (error instanceof ConvexError) throw error;
      throw new ConvexError({
        code: "DAYTONA_ENV_UPDATE_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const removeSandboxEnvironmentVariable = action({
  args: {
    projectId: v.string(),
    envName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project = await ctx.runQuery(internal.projects.getSandboxEnvironmentInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });
    const existingSecret = project.sandboxSecrets.find((secret) => secret.envName === args.envName);
    const existingVariable = project.sandboxEnvironmentVariables.find((variable) => variable.envName === args.envName);
    if (!existingSecret && !existingVariable) return null;

    const daytona = createDaytonaClient();
    const sandbox = await ensureSandboxStarted(project.sandboxId);
    const remaining = project.sandboxSecrets.filter((secret) => secret.envName !== args.envName);
    const remainingMap = Object.fromEntries(remaining.map((secret) => [secret.envName, secret.secretName]));

    try {
      await sandbox.updateEnv({}, { unset: [args.envName] });
      if (existingSecret) {
        await sandbox.updateSecrets(remainingMap);
        await daytona.secret.delete(existingSecret.secretId).catch((error: unknown) => {
          if (!isSandboxNotFoundError(error)) throw error;
        });
      }
      await ctx.runMutation(internal.projects.removeSandboxEnvironmentVariableInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        envName: args.envName,
      });
      return null;
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_ENV_DELETE_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const removeWithSandbox = action({
  args: {
    projectId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project = await ctx.runQuery(internal.projects.getForRemovalInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });

    if (project.sandboxId) {
      await ctx.runMutation(internal.sandboxCosts.markPendingFinalizationInternal, {
        authorId: identity.subject,
        projectId: project.projectId,
        sandboxId: project.sandboxId,
        sandboxName: project.sandboxName,
        repoFullName: project.repoFullName,
        sandboxCreatedAt: project.createdAt,
      });
      try {
        await deleteDaytonaSandbox(project.sandboxId);
      } catch (error) {
        if (!isSandboxNotFoundError(error)) {
          throw new ConvexError({
            code: "DAYTONA_SANDBOX_DELETE_FAILED",
            message: errorMessage(error),
          });
        }
      }
    }

    if (project.sandboxSecrets.length > 0) {
      const daytona = createDaytonaClient();
      for (const secret of project.sandboxSecrets) {
        try {
          await daytona.secret.delete(secret.secretId);
        } catch (error) {
          if (!isSandboxNotFoundError(error)) {
            throw new ConvexError({
              code: "DAYTONA_SECRET_DELETE_FAILED",
              message: errorMessage(error),
            });
          }
        }
      }
    }

    await ctx.runMutation(internal.projects.removeInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });

    return null;
  },
});

export const bindProvisionedSandbox = action({
  args: {
    projectId: v.string(),
    sandboxId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project: { projectId: string; repoName: string; cloneUrl: string } = await ctx.runQuery(
      internal.projects.getSandboxBindingTargetInternal,
      {
        authorId: identity.subject,
        projectId: args.projectId,
      },
    );

    const daytona = createDaytonaClient();
    const sandbox = await retryDaytonaRateLimit(() => daytona.get(args.sandboxId));
    if (!isExpectedAutoprSandbox(sandbox, project.projectId)) {
      throw new ConvexError({
        code: "INVALID_SANDBOX_BINDING",
        message: "The provisioned sandbox belongs to a different project.",
      });
    }

    const repoDirectory = sandboxRepositoryDirectoryName({
      repoName: project.repoName,
      repoUrl: project.cloneUrl,
    });
    const sandboxWorkDir = sandboxRepositoryPath(DEFAULT_SANDBOX_WORKDIR, repoDirectory);
    await sandbox.git.status(sandboxWorkDir);

    await ctx.runMutation(internal.projects.markSandboxReadyInternal, {
      authorId: identity.subject,
      projectId: project.projectId,
      sandboxId: sandbox.id,
      sandboxName: sandbox.name,
      sandboxSnapshot: sandbox.snapshot,
      sandboxWorkDir,
    });
    return null;
  },
});

export const ensureForGithubRepo = action({
  args: {
    githubUrl: v.string(),
  },
  returns: v.object({
    projectId: v.string(),
    reused: v.boolean(),
    sandboxStatus: sandboxStatusValidator,
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<EnsureProjectResult> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    let repo;
    try {
      repo = normalizeGithubUrl(args.githubUrl);
    } catch (error) {
      throw new ConvexError({
        code: "INVALID_GITHUB_URL",
        message: errorMessage(error),
      });
    }

    const project: EnsuredProject = await ctx.runMutation(internal.projects.ensureForGithubRepoInternal, {
      authorId: identity.subject,
      ...repo,
    });

    if (!project.created) {
      return {
        projectId: project.projectId,
        reused: true,
        sandboxStatus: project.sandboxStatus,
      };
    }

    try {
      const sandbox = await bootstrapRepositorySandbox({
        cacheKey: project.projectId,
        repoUrl: repo.cloneUrl,
        repoBranch: repo.repoBranch,
        repoName: repo.repoName,
      });

      await ctx.runMutation(internal.projects.markSandboxReadyInternal, {
        authorId: identity.subject,
        projectId: project.projectId,
        sandboxId: sandbox.sandboxId,
        sandboxName: sandbox.sandboxName,
        sandboxSnapshot: sandbox.sandboxSnapshot,
        sandboxWorkDir: sandbox.sandboxWorkDir,
      });

      return {
        projectId: project.projectId,
        reused: false,
        sandboxStatus: "ready",
      };
    } catch (error) {
      const message = errorMessage(error);
      const userMessage = `Could not create or clone the sandbox: ${message}`;

      await ctx.runMutation(internal.projects.markSandboxFailedInternal, {
        authorId: identity.subject,
        projectId: project.projectId,
        sandboxError: message,
      });

      return {
        projectId: project.projectId,
        reused: false,
        sandboxStatus: "failed",
        error: userMessage,
      };
    }
  },
});
