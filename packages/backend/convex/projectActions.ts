"use node";

import * as daytonaSdk from "@daytona/sdk";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { normalizeGithubUrl } from "./lib/github";

const sandboxStatusValidator = v.union(v.literal("creating"), v.literal("ready"), v.literal("failed"));

type SandboxStatus = "creating" | "ready" | "failed";

const DEFAULT_DAYTONA_SNAPSHOT = "daytonaio/sandbox:0.6.0";
const DEFAULT_SANDBOX_WORKDIR = "/home/daytona";
const SANDBOX_AUTO_STOP_INTERVAL_MINUTES = 15;
const REPO_PATH = "repo";
const DAYTONA_NOVNC_PORT = 6080;
const DESKTOP_PREVIEW_EXPIRES_SECONDS = 10 * 60;
const DESKTOP_STATUS_TIMEOUT_MS = 20_000;
const DESKTOP_STATUS_POLL_MS = 1_000;

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function isSandboxNotFoundError(error: unknown) {
  const message = errorMessage(error).toLowerCase();

  return message.includes("not found") || message.includes("404");
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

async function getDaytonaDesktopPreview(sandboxId: string): Promise<DesktopPreviewResult> {
  const daytona = createDaytonaClient();
  const sandbox = await daytona.get(sandboxId);

  if (sandbox.state && sandbox.state !== "started") {
    await sandbox.start(120);
  }

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
      return await getDaytonaDesktopPreview(project.sandboxId);
    } catch (error) {
      throw new ConvexError({
        code: "DAYTONA_DESKTOP_FAILED",
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
