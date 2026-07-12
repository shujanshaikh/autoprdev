"use node";

import * as daytonaSdk from "@daytona/sdk";
import type { Sandbox as DaytonaSandbox } from "@daytona/sdk";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { normalizeGithubUrl } from "./lib/github";

const sandboxStatusValidator = v.union(v.literal("creating"), v.literal("ready"), v.literal("failed"));

type SandboxStatus = "creating" | "ready" | "failed";

const DEFAULT_DAYTONA_SNAPSHOT = "autopr";
const DEFAULT_SANDBOX_WORKDIR = "/home";
const SANDBOX_AUTO_STOP_INTERVAL_MINUTES = 15;
const SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES = 2 * 60;
const DAYTONA_NOVNC_PORT = 6080;
const DAYTONA_WEB_TERMINAL_PORT = 22222;
const DESKTOP_PREVIEW_EXPIRES_SECONDS = 10 * 60;
const DESKTOP_STATUS_TIMEOUT_MS = 20_000;
const DESKTOP_STATUS_POLL_MS = 1_000;
const DESKTOP_RECOVERY_DELAY_MS = 1_000;
const MAX_DESKTOP_DIAGNOSTIC_LENGTH = 400;
const SANDBOX_START_TIMEOUT_SECONDS = 120;
const SANDBOX_START_POLL_MS = 1_000;
const DAYTONA_OPERATION_READY_TIMEOUT_MS = 30_000;
const DAYTONA_OPERATION_READY_POLL_MS = 2_000;
const SANDBOX_RUNTIME_STATUS_CACHE_MS = 60_000;
const MAX_SECRET_VALUE_LENGTH = 64 * 1024;
const MAX_SECRET_HOSTS = 50;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_HOST_PATTERN = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
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

interface PtyTerminalResult {
  sessionId: string;
  websocketUrl: string;
  cwd: string;
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

function createDaytonaClient() {
  const { Daytona } = daytonaSdk;
  return new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL,
  });
}

function normalizeSecretHosts(hosts: string[]): string[] {
  if (hosts.length > MAX_SECRET_HOSTS) {
    throw new ConvexError({ code: "TOO_MANY_SECRET_HOSTS", message: `Use at most ${MAX_SECRET_HOSTS} allowed hosts.` });
  }

  const normalized = [...new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean))];
  const invalid = normalized.find((host) => !SECRET_HOST_PATTERN.test(host));
  if (invalid) {
    throw new ConvexError({
      code: "INVALID_SECRET_HOST",
      message: `\"${invalid}\" is not a valid hostname. Omit protocols, paths, ports, and query strings.`,
    });
  }
  return normalized;
}

function validateSandboxSecretInput(envName: string, value: string, hosts: string[]) {
  const normalizedEnvName = envName.trim();
  if (!ENV_NAME_PATTERN.test(normalizedEnvName) || normalizedEnvName.length > 128) {
    throw new ConvexError({
      code: "INVALID_ENV_NAME",
      message: "Variable names must start with a letter or underscore and contain only letters, numbers, and underscores.",
    });
  }
  if (!value || value.length > MAX_SECRET_VALUE_LENGTH) {
    throw new ConvexError({
      code: "INVALID_SECRET_VALUE",
      message: `Secret values must be between 1 and ${MAX_SECRET_VALUE_LENGTH.toLocaleString()} characters.`,
    });
  }
  return { envName: normalizedEnvName, hosts: normalizeSecretHosts(hosts) };
}

function daytonaSecretName(projectId: string, envName: string): string {
  const projectPart = projectId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `autopr_${projectPart}_${envName}`.slice(0, 240);
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

async function ensureSandboxStarted(sandboxId: string) {
  const daytona = createDaytonaClient();
  const deadline = Date.now() + SANDBOX_START_TIMEOUT_SECONDS * 1000;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    const sandbox = await daytona.get(sandboxId);

    if (!sandbox.state || normalizeSandboxRuntimeStatus(sandbox.state) === "started") {
      return sandbox;
    }

    try {
      const timeoutSeconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
      await sandbox.start(timeoutSeconds);
      return sandbox;
    } catch (error) {
      if (!isSandboxStateChangeInProgressError(error)) {
        throw error;
      }
      lastError = error;
      await sleep(SANDBOX_START_POLL_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Sandbox did not become ready before the timeout.");
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
  const daytona = createDaytonaClient();
  const sandbox = await daytona.get(sandboxId);

  if (sandbox.state && normalizeSandboxRuntimeStatus(sandbox.state) !== "stopped") {
    await sandbox.stop();
  }

  return "stopped" as const;
}

async function runWithAlreadyStartedSandboxRetry<T>(
  sandboxId: string,
  operation: (sandbox: DaytonaSandbox) => Promise<T>,
): Promise<{ status: "started"; result: T } | { status: Exclude<SandboxRuntimeStatus, "started"> }> {
  const daytona = createDaytonaClient();
  const deadline = Date.now() + DAYTONA_OPERATION_READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    const sandbox = await daytona.get(sandboxId);
    const status = normalizeSandboxRuntimeStatus(sandbox.state);

    if (status !== "started") {
      return { status };
    }

    try {
      return { status, result: await operation(sandbox) };
    } catch (error) {
      if (!isSandboxNetworkNotReadyError(error) && !isSandboxStateChangeInProgressError(error)) {
        throw error;
      }
      lastError = error;
      await sleep(DAYTONA_OPERATION_READY_POLL_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Sandbox filesystem did not become ready.");
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

async function getDaytonaTerminalPreview(sandboxId: string): Promise<TerminalPreviewResult> {
  return runWithStartedSandboxRetry(sandboxId, async (sandbox) => {
    const preview = await sandbox.getSignedPreviewUrl(DAYTONA_WEB_TERMINAL_PORT, DESKTOP_PREVIEW_EXPIRES_SECONDS);

    return {
      url: normalizePreviewUrl(preview.url),
      port: DAYTONA_WEB_TERMINAL_PORT,
      expiresInSeconds: DESKTOP_PREVIEW_EXPIRES_SECONDS,
    };
  });
}

function ptyWebsocketUrl(toolboxProxyUrl: string, sandboxId: string, sessionId: string, token: string): string {
  const baseUrl = toolboxProxyUrl.endsWith("/") ? toolboxProxyUrl.slice(0, -1) : toolboxProxyUrl;
  const url = new URL(`${baseUrl}/${sandboxId}/process/pty/${encodeURIComponent(sessionId)}/connect`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("DAYTONA_SANDBOX_AUTH_KEY", token);
  return url.toString();
}

async function createDaytonaPtyTerminal(sandboxId: string, cwd: string, cols: number, rows: number): Promise<PtyTerminalResult> {
  return runWithStartedSandboxRetry(sandboxId, async (sandbox) => {
    const sessionId = `autopr-terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = await sandbox.process.createPty({
      id: sessionId,
      cwd,
      envs: {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
        CLICOLOR: "1",
        FORCE_COLOR: "1",
      },
      cols,
      rows,
      onData: () => undefined,
    });
    await handle.disconnect().catch(() => undefined);

    const preview = await sandbox.getPreviewLink(1);

    return {
      sessionId,
      websocketUrl: ptyWebsocketUrl(sandbox.toolboxProxyUrl, sandbox.id, sessionId, preview.token),
      cwd,
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
    snapshot: options.snapshot ?? process.env.DAYTONA_SNAPSHOT ?? DEFAULT_DAYTONA_SNAPSHOT,
    autoStopInterval: SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
    autoArchiveInterval: SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES,
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

export const getPtyTerminal = action({
  args: {
    projectId: v.string(),
    cols: v.optional(v.number()),
    rows: v.optional(v.number()),
  },
  returns: v.object({
    sessionId: v.string(),
    websocketUrl: v.string(),
    cwd: v.string(),
  }),
  handler: async (ctx, args): Promise<PtyTerminalResult> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project: { sandboxId: string; repoName: string; sandboxWorkDir?: string } = await ctx.runQuery(internal.projects.getDesktopSandboxInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });
    const cwd = project.sandboxWorkDir ?? sandboxRepositoryPath(
      DEFAULT_SANDBOX_WORKDIR,
      sandboxRepositoryDirectoryName({ repoName: project.repoName }),
    );

    try {
      const terminal = await createDaytonaPtyTerminal(project.sandboxId, cwd, args.cols ?? 100, args.rows ?? 30);
      await ctx.runMutation(internal.projects.updateSandboxRuntimeStatusInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        sandboxRuntimeStatus: "started",
      });
      return terminal;
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_PTY_TERMINAL_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const resizePtyTerminal = action({
  args: {
    projectId: v.string(),
    sessionId: v.string(),
    cols: v.number(),
    rows: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const project: { sandboxId: string } = await ctx.runQuery(internal.projects.getDesktopSandboxInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });

    try {
      await runWithStartedSandboxRetry(project.sandboxId, async (sandbox) => {
        await sandbox.process.resizePtySession(args.sessionId, args.cols, args.rows);
      });
      return null;
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_PTY_RESIZE_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const getTerminalPreview = action({
  args: {
    projectId: v.string(),
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

    const project: { sandboxId: string } = await ctx.runQuery(internal.projects.getDesktopSandboxInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });

    try {
      const preview = await getDaytonaTerminalPreview(project.sandboxId);
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

export const upsertSandboxSecret = action({
  args: {
    projectId: v.string(),
    envName: v.string(),
    value: v.string(),
    hosts: v.array(v.string()),
  },
  returns: v.object({
    envName: v.string(),
    restarted: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ envName: string; restarted: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }

    const input = validateSandboxSecretInput(args.envName, args.value, args.hosts);
    const project = await ctx.runQuery(internal.projects.getSandboxSecretsInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });
    const existing = project.sandboxSecrets.find((secret) => secret.envName === input.envName);
    const daytona = createDaytonaClient();

    try {
      if (existing) {
        await daytona.secret.update(existing.secretId, {
          value: args.value,
          hosts: input.hosts,
          description: `AutoPR project ${project.repoFullName} · ${input.envName}`,
        });
        await ctx.runMutation(internal.projects.upsertSandboxSecretInternal, {
          authorId: identity.subject,
          projectId: args.projectId,
          secret: {
            ...existing,
            hosts: input.hosts,
            updatedAt: Date.now(),
          },
        });
        return { envName: input.envName, restarted: false };
      }

      const secretName = daytonaSecretName(args.projectId, input.envName);
      const matchingSecrets = await daytona.secret.list({ name: secretName, limit: 10 });
      const orphanedSecret = matchingSecrets.items.find((secret) => secret.name === secretName);
      const secret = orphanedSecret
        ? await daytona.secret.update(orphanedSecret.id, {
            value: args.value,
            description: `AutoPR project ${project.repoFullName} · ${input.envName}`,
            hosts: input.hosts,
          })
        : await daytona.secret.create({
            name: secretName,
            value: args.value,
            description: `AutoPR project ${project.repoFullName} · ${input.envName}`,
            hosts: input.hosts.length > 0 ? input.hosts : undefined,
          });

      try {
        const sandbox = await ensureSandboxStarted(project.sandboxId);
        const mountedSecrets = Object.fromEntries([
          ...project.sandboxSecrets.map((item) => [item.envName, item.secretName] as const),
          [input.envName, secretName] as const,
        ]);
        await sandbox.updateSecrets(mountedSecrets);

        const restarted = project.sandboxSecrets.length === 0;
        if (restarted) {
          await sandbox.stop();
          await sandbox.start(SANDBOX_START_TIMEOUT_SECONDS);
        }

        await ctx.runMutation(internal.projects.upsertSandboxSecretInternal, {
          authorId: identity.subject,
          projectId: args.projectId,
          secret: {
            envName: input.envName,
            secretId: secret.id,
            secretName,
            hosts: input.hosts,
            updatedAt: Date.now(),
          },
        });
        try {
          const latestProject = await ctx.runQuery(internal.projects.getSandboxSecretsInternal, {
            authorId: identity.subject,
            projectId: args.projectId,
          });
          await sandbox.updateSecrets(Object.fromEntries(
            latestProject.sandboxSecrets.map((item) => [item.envName, item.secretName]),
          ));
        } catch {
          // The new secret is already mounted and recorded. A later update reconciles the full map.
        }
        return { envName: input.envName, restarted };
      } catch (error) {
        const originalMap = Object.fromEntries(
          project.sandboxSecrets.map((item) => [item.envName, item.secretName]),
        );
        const sandbox = await daytona.get(project.sandboxId).catch(() => undefined);
        await sandbox?.updateSecrets(originalMap).catch(() => undefined);
        if (!orphanedSecret) {
          await daytona.secret.delete(secret.id).catch(() => undefined);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw new ConvexError({
        code: "DAYTONA_SECRET_UPDATE_FAILED",
        message: errorMessage(error),
      });
    }
  },
});

export const removeSandboxSecret = action({
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

    const project = await ctx.runQuery(internal.projects.getSandboxSecretsInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });
    const existing = project.sandboxSecrets.find((secret) => secret.envName === args.envName);
    if (!existing) return null;

    const daytona = createDaytonaClient();
    const sandbox = await ensureSandboxStarted(project.sandboxId);
    const remaining = project.sandboxSecrets.filter((secret) => secret.envName !== existing.envName);
    const remainingMap = Object.fromEntries(remaining.map((secret) => [secret.envName, secret.secretName]));

    try {
      await sandbox.updateSecrets(remainingMap);
      try {
        await daytona.secret.delete(existing.secretId);
      } catch (error) {
        if (!isSandboxNotFoundError(error)) {
          const originalMap = Object.fromEntries(
            project.sandboxSecrets.map((secret) => [secret.envName, secret.secretName]),
          );
          await sandbox.updateSecrets(originalMap).catch(() => undefined);
          throw error;
        }
      }
      await ctx.runMutation(internal.projects.removeSandboxSecretInternal, {
        authorId: identity.subject,
        projectId: args.projectId,
        envName: existing.envName,
      });
      return null;
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_SECRET_DELETE_FAILED",
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
