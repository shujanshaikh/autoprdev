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
const DEFAULT_SANDBOX_WORKDIR = "/home/daytona";
const SANDBOX_AUTO_STOP_INTERVAL_MINUTES = 15;
const SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES = 2 * 60;
const REPO_PATH = "repo";
const DAYTONA_NOVNC_PORT = 6080;
const DAYTONA_WEB_TERMINAL_PORT = 22222;
const DEFAULT_TERMINAL_CWD = "/home/daytona/repo";
const DESKTOP_PREVIEW_EXPIRES_SECONDS = 10 * 60;
const DESKTOP_STATUS_TIMEOUT_MS = 20_000;
const DESKTOP_STATUS_POLL_MS = 1_000;
const SANDBOX_START_TIMEOUT_SECONDS = 120;
const SANDBOX_START_POLL_MS = 1_000;
const DAYTONA_OPERATION_READY_TIMEOUT_MS = 30_000;
const DAYTONA_OPERATION_READY_POLL_MS = 2_000;
const SANDBOX_RUNTIME_STATUS_CACHE_MS = 60_000;

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
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
  if (!value || typeof value !== "object") return undefined;
  const status = (value as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
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

async function waitForDesktopReady(sandbox: { computerUse: { getStatus(): Promise<unknown> } }): Promise<void> {
  const deadline = Date.now() + DESKTOP_STATUS_TIMEOUT_MS;
  let lastStatus: string | undefined;

  while (Date.now() < deadline) {
    lastStatus = computerUseStatus(await sandbox.computerUse.getStatus());
    if (lastStatus === "active") return;
    await sleep(DESKTOP_STATUS_POLL_MS);
  }

  throw new Error(`VNC desktop not ready${lastStatus ? `: ${lastStatus}` : ""}.`);
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
    await sandbox.computerUse.start();
    await waitForDesktopReady(sandbox);

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

async function createDaytonaPtyTerminal(sandboxId: string, cols: number, rows: number): Promise<PtyTerminalResult> {
  return runWithStartedSandboxRetry(sandboxId, async (sandbox) => {
    const sessionId = `autopr-terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const handle = await sandbox.process.createPty({
      id: sessionId,
      cwd: DEFAULT_TERMINAL_CWD,
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
      cwd: DEFAULT_TERMINAL_CWD,
    };
  });
}

async function bootstrapRepositorySandbox(options: {
  cacheKey: string;
  repoUrl: string;
  repoBranch?: string;
  snapshot?: string;
}) {
  const daytona = createDaytonaClient();
  const sandbox = await daytona.create({
    snapshot: options.snapshot ?? process.env.DAYTONA_SNAPSHOT ?? DEFAULT_DAYTONA_SNAPSHOT,
    autoStopInterval: SANDBOX_AUTO_STOP_INTERVAL_MINUTES,
    autoArchiveInterval: SANDBOX_AUTO_ARCHIVE_INTERVAL_MINUTES,
  });
  const sandboxWorkDir = (await sandbox.getWorkDir()) ?? DEFAULT_SANDBOX_WORKDIR;
  const repoPath = `${sandboxWorkDir}/${REPO_PATH}`;

  try {
    await sandbox.git.status(REPO_PATH);
  } catch {
    await sandbox.git.clone(options.repoUrl, REPO_PATH, options.repoBranch);
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

    const project: { sandboxId: string } = await ctx.runQuery(internal.projects.getDesktopSandboxInternal, {
      authorId: identity.subject,
      projectId: args.projectId,
    });

    try {
      const terminal = await createDaytonaPtyTerminal(project.sandboxId, args.cols ?? 100, args.rows ?? 30);
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
