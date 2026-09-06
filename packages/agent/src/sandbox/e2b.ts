import {
  CommandExitError,
  FileNotFoundError,
  Sandbox as E2BSdkSandbox,
  SandboxNotFoundError,
  Secret,
  type CommandHandle,
} from "e2b";

import type { SandboxAdapter, SandboxSessionOptions } from "./index";
import { SandboxRuntimeNotStartedError } from "./errors";
import { E2B_SANDBOX_WORKDIR } from "./repo-path";

const DEFAULT_E2B_TEMPLATE = "autopr";
const E2B_TIMEOUT_MS = 15 * 60_000;
const E2B_REQUEST_TIMEOUT_MS = 120_000;
const E2B_BACKGROUND_COMMAND_TIMEOUT_MS = 24 * 60 * 60_000;
const E2B_DESKTOP_COMMAND = "/opt/autopr/bin/autopr-desktop";
const E2B_RECORDINGS_DIR = `${E2B_SANDBOX_WORKDIR}/.autopr/recordings`;
const E2B_PREVIEW_GATEWAY_PORT = 6_090;
const E2B_PREVIEW_SECRET_FILE = `${E2B_SANDBOX_WORKDIR}/.autopr/preview-secret`;
const E2B_PREVIEW_DEFAULT_TTL_SECONDS = 5 * 60;
const E2B_PREVIEW_MAX_TTL_SECONDS = 24 * 60 * 60;
const E2B_SESSION_CACHE_TTL_MS = 2 * 60 * 60_000;
const E2B_MAX_CACHED_SANDBOXES = 32;
const E2B_MAX_SESSIONS_PER_SANDBOX = 32;
const E2B_MAX_COMMANDS_PER_SESSION = 32;
const E2B_MAX_COMPLETED_COMMANDS_PER_SESSION = 8;
const E2B_MAX_COMMAND_OUTPUT_CHARS = 64 * 1_024;
export const E2B_ENV_MANIFEST = `${E2B_SANDBOX_WORKDIR}/.autopr/environment.json`;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type E2BCommandState = {
  command: string;
  handle?: CommandHandle;
  exitCode?: number;
  stdout: string;
  stderr: string;
  reconnecting?: Promise<void>;
};

type E2BSessionState = {
  commands: Map<string, E2BCommandState>;
};

type E2BSandboxSessionCache = {
  lastAccessedAt: number;
  sessions: Map<string, E2BSessionState>;
};

// Adapter instances are short-lived, so completed session state is TTL/LRU
// bounded while active command handles stay pollable across reconnects.
const sessionsBySandbox = new Map<string, E2BSandboxSessionCache>();

type E2BRecording = {
  id: string;
  title?: string;
  label?: string;
  fileName: string;
  filePath: string;
  status: "recording" | "completed";
  startTime?: string;
  endTime?: string;
  durationSeconds?: number;
  sizeBytes?: number;
};

function commandFailure(error: unknown) {
  if (error instanceof CommandExitError) {
    return {
      exitCode: error.exitCode,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
  throw error;
}

function commandOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].filter(Boolean).join(stderr && stdout ? "\n" : "");
}

function boundedSessionOutput(value: string): string {
  if (value.length <= E2B_MAX_COMMAND_OUTPUT_CHARS) return value;
  return `[Earlier output truncated.]\n${value.slice(-E2B_MAX_COMMAND_OUTPUT_CHARS)}`;
}

function pruneCompletedCommands(session: E2BSessionState, reserveSlot = false): void {
  const completed = [...session.commands].filter(([, command]) => command.exitCode !== undefined);
  const maxCompleted = Math.min(
    E2B_MAX_COMPLETED_COMMANDS_PER_SESSION,
    E2B_MAX_COMMANDS_PER_SESSION - (reserveSlot ? 1 : 0),
  );
  while (
    completed.length > maxCompleted
    || session.commands.size > E2B_MAX_COMMANDS_PER_SESSION - (reserveSlot ? 1 : 0)
  ) {
    const oldest = completed.shift();
    if (!oldest) break;
    session.commands.delete(oldest[0]);
  }
}

function hasActiveCommands(cache: E2BSandboxSessionCache): boolean {
  return [...cache.sessions.values()].some((session) =>
    [...session.commands.values()].some((command) => command.exitCode === undefined)
  );
}

function oldestEvictableSandboxCache() {
  return [...sessionsBySandbox]
    .filter(([, cache]) => !hasActiveCommands(cache))
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)[0];
}

function pruneSandboxSessionCaches(now = Date.now()): void {
  for (const [sandboxId, cache] of sessionsBySandbox) {
    if (
      cache.lastAccessedAt <= now - E2B_SESSION_CACHE_TTL_MS
      && !hasActiveCommands(cache)
    ) {
      sessionsBySandbox.delete(sandboxId);
    }
  }
  while (sessionsBySandbox.size > E2B_MAX_CACHED_SANDBOXES) {
    const oldest = oldestEvictableSandboxCache();
    if (!oldest) break;
    sessionsBySandbox.delete(oldest[0]);
  }
}

function sandboxSessionCache(sandboxId: string): E2BSandboxSessionCache {
  const now = Date.now();
  pruneSandboxSessionCaches(now);
  const existing = sessionsBySandbox.get(sandboxId);
  if (existing) {
    existing.lastAccessedAt = now;
    return existing;
  }
  while (sessionsBySandbox.size >= E2B_MAX_CACHED_SANDBOXES) {
    const oldest = oldestEvictableSandboxCache();
    if (!oldest) break;
    sessionsBySandbox.delete(oldest[0]);
  }
  const created = { lastAccessedAt: now, sessions: new Map<string, E2BSessionState>() };
  sessionsBySandbox.set(sandboxId, created);
  return created;
}

function metadataName(metadata: Record<string, string>): string | undefined {
  const value = metadata.autoprSandboxName;
  return value?.trim() || undefined;
}

function e2bMetadata(options: SandboxSessionOptions): Record<string, string> {
  return {
    ...(options.labels ?? {}),
    ...(options.name ? { autoprSandboxName: options.name } : {}),
    autoprProvider: "e2b",
  };
}

function e2bNetwork() {
  const configured = process.env.E2B_DOMAIN_ALLOW_LIST?.trim();
  return {
    allowPublicTraffic: true,
    ...(configured
      ? {
          allowOut: configured
            .split(/[\s,]+/)
            .map((value: string) => value.trim())
            .filter(Boolean),
        }
      : {}),
  };
}

async function runCommand(
  sandbox: E2BSdkSandbox,
  command: string,
  options: {
    cwd?: string;
    envs?: Record<string, string>;
    timeoutMs?: number;
  } = {},
) {
  try {
    return await sandbox.commands.run(command, {
      cwd: options.cwd,
      envs: options.envs,
      timeoutMs: options.timeoutMs ?? E2B_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    return commandFailure(error);
  }
}

function recordingPath(id: string): string {
  return `${E2B_RECORDINGS_DIR}/${id}.mp4`;
}

function recordingMetadataPath(id: string): string {
  return `${E2B_RECORDINGS_DIR}/${id}.json`;
}

function assertRecordingId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error("Invalid E2B recording ID.");
  }
  return id;
}

async function e2bPreviewSignature(secret: string, value: string): Promise<string> {
  const nodeCrypto = "node:crypto";
  const { createHmac } = await import(nodeCrypto) as unknown as {
    createHmac(algorithm: string, key: string): {
      update(data: string): { digest(encoding: "base64url"): string };
    };
  };
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export class E2BSandboxAdapter implements SandboxAdapter {
  readonly id: string;
  readonly snapshot?: string;
  readonly autoStopInterval = E2B_TIMEOUT_MS / 60_000;
  readonly toolboxProxyUrl?: string;
  readonly domainAllowList?: string;
  name?: string;
  state?: string;

  private sdk: E2BSdkSandbox;
  private readonly sessionCache: E2BSandboxSessionCache;
  private readonly sessions: Map<string, E2BSessionState>;

  constructor(
    sdk: E2BSdkSandbox,
    info: {
      name?: string;
      templateId?: string;
      state?: string;
      metadata?: Record<string, string>;
    } = {},
  ) {
    this.sdk = sdk;
    this.id = sdk.sandboxId;
    this.name = metadataName(info.metadata ?? {}) ?? info.name;
    this.snapshot = info.templateId;
    this.state = info.state === "running" ? "started" : info.state === "paused" ? "stopped" : info.state;
    this.sessionCache = sandboxSessionCache(this.id);
    this.sessions = this.sessionCache.sessions;
  }

  async start(timeout?: number): Promise<void> {
    this.sdk = await E2BSdkSandbox.connect(this.id, {
      timeoutMs: E2B_TIMEOUT_MS,
      requestTimeoutMs: timeout === undefined ? E2B_REQUEST_TIMEOUT_MS : timeout * 1_000,
    });
    this.state = "started";
  }

  async refreshActivity(): Promise<void> {
    await this.sdk.setTimeout(E2B_TIMEOUT_MS);
  }

  async updateNetworkSettings(): Promise<void> {
    // E2B applies the network policy at creation. Existing E2B sandboxes keep
    // their immutable template-era policy until they are recreated.
  }

  async getWorkDir(): Promise<string> {
    return E2B_SANDBOX_WORKDIR;
  }

  async getSignedPreviewUrl(
    port: number,
    expiresInSeconds = E2B_PREVIEW_DEFAULT_TTL_SECONDS,
  ): Promise<{ url: string }> {
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || port === E2B_PREVIEW_GATEWAY_PORT) {
      throw new Error("E2B preview port must be an integer between 1 and 65535.");
    }
    if (
      !Number.isInteger(expiresInSeconds)
      || expiresInSeconds < 1
      || expiresInSeconds > E2B_PREVIEW_MAX_TTL_SECONDS
    ) {
      throw new Error("E2B preview expiry must be between 1 second and 24 hours.");
    }

    const gatewayStatus = await runCommand(
      this.sdk,
      `${E2B_DESKTOP_COMMAND} process-status preview`,
      { timeoutMs: 30_000 },
    );
    if (gatewayStatus.exitCode !== 0) {
      const restarted = await runCommand(
        this.sdk,
        `${E2B_DESKTOP_COMMAND} restart preview`,
        { timeoutMs: 30_000 },
      );
      if (restarted.exitCode !== 0) {
        throw new Error(restarted.stderr || "Could not start the E2B preview gateway.");
      }
    }

    const secret = (await this.sdk.files.read(E2B_PREVIEW_SECRET_FILE)).trim();
    if (!/^[a-f0-9]{64}$/.test(secret)) {
      throw new Error("The E2B preview gateway secret is unavailable.");
    }
    const expiresAt = Math.floor(Date.now() / 1_000) + expiresInSeconds;
    const signature = await e2bPreviewSignature(secret, `${expiresAt}:${port}`);

    return {
      url: `https://${this.sdk.getHost(E2B_PREVIEW_GATEWAY_PORT)}/v1/${expiresAt}/${port}/${signature}`,
    };
  }

  readonly computerUse = {
    start: async (): Promise<unknown> => {
      const result = await runCommand(this.sdk, `${E2B_DESKTOP_COMMAND} start`, { timeoutMs: 120_000 });
      if (result.exitCode !== 0) throw new Error(result.stderr || "Could not start the E2B desktop.");
      return { status: "active" };
    },
    stop: async (): Promise<unknown> => {
      const result = await runCommand(this.sdk, `${E2B_DESKTOP_COMMAND} stop`, { timeoutMs: 60_000 });
      if (result.exitCode !== 0) throw new Error(result.stderr || "Could not stop the E2B desktop.");
      return { status: "stopped" };
    },
    getStatus: async (): Promise<unknown> => {
      const result = await runCommand(this.sdk, `${E2B_DESKTOP_COMMAND} status`, { timeoutMs: 30_000 });
      return { status: result.exitCode === 0 ? "active" : "stopped" };
    },
    getProcessStatus: async (processName: string): Promise<unknown> => {
      const result = await runCommand(
        this.sdk,
        `${E2B_DESKTOP_COMMAND} process-status '${processName.replace(/'/g, "'\\''")}'`,
        { timeoutMs: 30_000 },
      );
      return {
        name: processName,
        running: result.exitCode === 0,
        status: result.exitCode === 0 ? "running" : "stopped",
      };
    },
    restartProcess: async (processName: string): Promise<unknown> => {
      const result = await runCommand(
        this.sdk,
        `${E2B_DESKTOP_COMMAND} restart '${processName.replace(/'/g, "'\\''")}'`,
        { timeoutMs: 90_000 },
      );
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `Could not restart E2B desktop process ${processName}.`);
      }
      return { name: processName, status: "running", running: true };
    },
    getProcessLogs: async (processName: string): Promise<unknown> => {
      const result = await runCommand(
        this.sdk,
        `${E2B_DESKTOP_COMMAND} logs '${processName.replace(/'/g, "'\\''")}'`,
        { timeoutMs: 30_000 },
      );
      return { logs: result.stdout };
    },
    getProcessErrors: async (processName: string): Promise<unknown> => {
      const result = await runCommand(
        this.sdk,
        `${E2B_DESKTOP_COMMAND} logs '${processName.replace(/'/g, "'\\''")}'`,
        { timeoutMs: 30_000 },
      );
      return { errors: result.stderr || result.stdout };
    },
    recording: {
      start: async (label?: string): Promise<unknown> => {
        const id = crypto.randomUUID();
        const filePath = recordingPath(id);
        const metadata: E2BRecording = {
          id,
          title: label,
          label,
          fileName: `${id}.mp4`,
          filePath,
          status: "recording",
          startTime: new Date().toISOString(),
        };
        const envs = {
          AUTOPR_RECORDING_ID: id,
          AUTOPR_RECORDING_PATH: filePath,
          AUTOPR_RECORDING_METADATA: JSON.stringify(metadata),
        };
        const result = await runCommand(
          this.sdk,
          [
            `mkdir -p '${E2B_RECORDINGS_DIR}'`,
            `printf '%s' \"$AUTOPR_RECORDING_METADATA\" > '${recordingMetadataPath(id)}'`,
            "{ nohup ffmpeg -y -f x11grab -framerate 30 -video_size 1920x1080 -i :1 -c:v libx264 -preset veryfast -pix_fmt yuv420p \"$AUTOPR_RECORDING_PATH\" >\"$AUTOPR_RECORDING_PATH.log\" 2>&1 & printf '%s' \"$!\" > \"$AUTOPR_RECORDING_PATH.pid\"; }",
          ].join(" && "),
          { envs, timeoutMs: 30_000 },
        );
        if (result.exitCode !== 0) throw new Error(result.stderr || "Could not start the E2B recording.");
        return metadata;
      },
      stop: async (recordingId: string): Promise<unknown> => {
        const id = assertRecordingId(recordingId);
        const filePath = recordingPath(id);
        const result = await runCommand(
          this.sdk,
          [
            `test -s '${filePath}.pid'`,
            `kill -INT "$(cat '${filePath}.pid')" 2>/dev/null || true`,
            `for _ in $(seq 1 100); do kill -0 "$(cat '${filePath}.pid')" 2>/dev/null || break; sleep 0.1; done`,
            `! kill -0 "$(cat '${filePath}.pid')" 2>/dev/null`,
            `rm -f '${filePath}.pid'`,
            `test -s '${filePath}'`,
          ].join(" && "),
          { timeoutMs: 30_000 },
        );
        if (result.exitCode !== 0) throw new Error(result.stderr || "Could not stop the E2B recording.");
        const existing = await this.readRecording(id);
        const now = new Date();
        const startTime = existing.startTime ? new Date(existing.startTime) : now;
        const stopped: E2BRecording = {
          ...existing,
          status: "completed",
          endTime: now.toISOString(),
          durationSeconds: Math.max(0, (now.getTime() - startTime.getTime()) / 1_000),
          sizeBytes: Number.parseInt((await runCommand(this.sdk, `stat -c %s '${filePath}'`)).stdout.trim(), 10) || undefined,
        };
        await this.sdk.files.write(recordingMetadataPath(id), JSON.stringify(stopped));
        return stopped;
      },
      list: async (): Promise<unknown> => {
        const entries = await this.sdk.files.list(E2B_RECORDINGS_DIR).catch(() => []);
        const ids = entries
          .map((entry) => entry.name.match(/^([A-Za-z0-9_-]+)\.json$/)?.[1])
          .filter((value): value is string => Boolean(value));
        return { recordings: await Promise.all(ids.map((id) => this.readRecording(id))) };
      },
      get: async (recordingId: string): Promise<unknown> => this.readRecording(assertRecordingId(recordingId)),
      download: async (recordingId: string, localPath: string): Promise<void> => {
        const bytes = await this.sdk.files.read(recordingPath(assertRecordingId(recordingId)), { format: "bytes" });
        const nodeFsPromises = "node:fs/promises";
        const { writeFile } = await import(nodeFsPromises) as unknown as {
          writeFile(path: string, data: Uint8Array): Promise<void>;
        };
        await writeFile(localPath, bytes);
      },
    },
  };

  readonly git = {
    status: async (path: string): Promise<unknown> => this.requiredGit(path, "status --porcelain"),
    clone: async (
      url: string,
      path: string,
      branch?: string,
      commitId?: string,
      username?: string,
      password?: string,
    ): Promise<unknown> => {
      const envs = username && password
        ? {
            GIT_ASKPASS: "/opt/autopr/bin/autopr-git-askpass",
            GIT_TERMINAL_PROMPT: "0",
            AUTOPR_GIT_USERNAME: username,
            AUTOPR_GIT_PASSWORD: password,
          }
        : undefined;
      const branchArg = branch ? ` --branch '${branch.replace(/'/g, "'\\''")}' --single-branch` : "";
      const result = await runCommand(
        this.sdk,
        `git clone${branchArg} -- '${url.replace(/'/g, "'\\''")}' '${path.replace(/'/g, "'\\''")}'`,
        { cwd: E2B_SANDBOX_WORKDIR, envs },
      );
      if (result.exitCode !== 0) throw new Error(result.stderr || "E2B git clone failed.");
      if (commitId) await this.requiredGit(path, `checkout '${commitId.replace(/'/g, "'\\''")}'`);
      return result;
    },
    add: async (path: string, files: string[]): Promise<unknown> =>
      this.requiredGit(path, `add -- ${files.map((file) => `'${file.replace(/'/g, "'\\''")}'`).join(" ")}`),
    commit: async (
      path: string,
      message: string,
      author: string,
      email: string,
      allowEmpty?: boolean,
    ): Promise<{ sha: string }> => {
      const envs = {
        GIT_AUTHOR_NAME: author,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: author,
        GIT_COMMITTER_EMAIL: email,
      };
      const empty = allowEmpty ? " --allow-empty" : "";
      const commit = await runCommand(
        this.sdk,
        `git commit${empty} -m '${message.replace(/'/g, "'\\''")}'`,
        { cwd: path, envs },
      );
      if (commit.exitCode !== 0) throw new Error(commit.stderr || "E2B git commit failed.");
      const sha = await this.requiredGit(path, "rev-parse HEAD");
      return { sha: sha.stdout.trim() };
    },
    push: async (
      path: string,
      username?: string,
      password?: string,
      branch?: string,
      remote = "origin",
      setUpstream?: boolean,
    ): Promise<unknown> => this.authenticatedGit(path, "push", username, password, remote, branch, setUpstream),
    pull: async (
      path: string,
      username?: string,
      password?: string,
      branch?: string,
      remote = "origin",
    ): Promise<unknown> => this.authenticatedGit(path, "pull", username, password, remote, branch, false),
  };

  readonly fs = {
    downloadFile: async (path: string): Promise<Uint8Array> =>
      await this.sdk.files.read(path, { format: "bytes" }),
    uploadFile: async (file: Uint8Array, path: string): Promise<unknown> => {
      const bytes = file;
      const data = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(data).set(bytes);
      return await this.sdk.files.write(path, data);
    },
    deleteFile: async (path: string): Promise<void> => {
      await this.sdk.files.remove(path);
    },
    listFiles: async (path: string): Promise<unknown[]> =>
      (await this.sdk.files.list(path)).map((entry) => ({
        ...entry,
        isDir: entry.type === "dir",
      })),
    searchFiles: async (path: string, pattern: string): Promise<{ files: string[] }> => {
      const result = await runCommand(
        this.sdk,
        `find '${path.replace(/'/g, "'\\''")}' -type f -name '${pattern.replace(/'/g, "'\\''")}' -print`,
      );
      if (result.exitCode !== 0) throw new Error(result.stderr || "E2B file search failed.");
      return { files: result.stdout.split("\n").filter(Boolean) };
    },
  };

  private touchSessionCache(): void {
    this.sessionCache.lastAccessedAt = Date.now();
  }

  private getOrCreateSession(sessionId: string): E2BSessionState {
    this.touchSessionCache();
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    for (const [cachedSessionId, session] of this.sessions) {
      if (this.sessions.size < E2B_MAX_SESSIONS_PER_SANDBOX) break;
      if ([...session.commands.values()].every((command) => command.exitCode !== undefined)) {
        this.sessions.delete(cachedSessionId);
      }
    }
    if (this.sessions.size >= E2B_MAX_SESSIONS_PER_SANDBOX) {
      throw new Error("The E2B sandbox has too many active command sessions.");
    }

    const created = { commands: new Map<string, E2BCommandState>() };
    this.sessions.set(sessionId, created);
    return created;
  }

  readonly process = {
    executeCommand: async (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => {
      const result = await runCommand(this.sdk, command, {
        cwd,
        envs: await this.commandEnvironment(env),
        timeoutMs: timeout ? timeout * 1_000 : undefined,
      });
      return {
        exitCode: result.exitCode,
        result: commandOutput(result.stdout, result.stderr),
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
    createSession: async (sessionId: string): Promise<unknown> => {
      this.getOrCreateSession(sessionId);
      return { sessionId };
    },
    executeSessionCommand: async (
      sessionId: string,
      command: { command: string; runAsync?: boolean; suppressInputEcho?: boolean },
      timeout?: number,
    ) => {
      const session = this.getOrCreateSession(sessionId);
      if (!command.runAsync) {
        const result = await runCommand(this.sdk, command.command, {
          envs: await this.commandEnvironment(),
          timeoutMs: timeout ? timeout * 1_000 : undefined,
        });
        return {
          cmdId: crypto.randomUUID(),
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          output: commandOutput(result.stdout, result.stderr),
        };
      }

      pruneCompletedCommands(session, true);
      if (session.commands.size >= E2B_MAX_COMMANDS_PER_SESSION) {
        throw new Error(`E2B session ${sessionId} has too many active commands.`);
      }

      const handle = await this.sdk.commands.run(command.command, {
        background: true,
        stdin: true,
        envs: await this.commandEnvironment(),
        // The session timeout bounds startup, not the lifetime of the process stream.
        requestTimeoutMs: timeout === undefined ? E2B_REQUEST_TIMEOUT_MS : timeout * 1_000,
        timeoutMs: E2B_BACKGROUND_COMMAND_TIMEOUT_MS,
      });
      const cmdId = String(handle.pid);
      const state: E2BCommandState = {
        command: command.command,
        handle,
        stdout: "",
        stderr: "",
      };
      session.commands.set(cmdId, state);
      this.trackCommand(session, state, handle);
      return { cmdId, stdout: "", stderr: "", output: "" };
    },
    getSessionCommand: async (sessionId: string, commandId: string) => {
      const command = await this.requireCommand(sessionId, commandId);
      return { command: command.command, exitCode: command.exitCode, id: commandId };
    },
    getSessionCommandLogs: async (sessionId: string, commandId: string) => {
      const command = await this.requireCommand(sessionId, commandId);
      const stdout = command.handle?.stdout || command.stdout;
      const stderr = command.handle?.stderr || command.stderr;
      return { stdout, stderr, output: commandOutput(stdout, stderr) };
    },
    sendSessionCommandInput: async (sessionId: string, commandId: string, data: string): Promise<void> => {
      const command = await this.requireCommand(sessionId, commandId);
      if (!command.handle || command.exitCode !== undefined) {
        throw new Error(`E2B command ${commandId} has already completed.`);
      }
      await command.handle.sendStdin(data);
    },
    listSessions: async () => {
      this.touchSessionCache();
      return [...this.sessions.entries()].map(([sessionId, session]) => ({
        sessionId,
        commands: [...session.commands.entries()].map(([id, command]) => ({
          command: command.command,
          exitCode: command.exitCode,
          id,
        })),
      }));
    },
    deleteSession: async (sessionId: string): Promise<unknown> => {
      this.touchSessionCache();
      const session = this.sessions.get(sessionId);
      if (!session) return { sessionId };
      const results = await Promise.allSettled([...session.commands].map(async ([id, command]) => {
        if (command.exitCode === undefined) await this.sdk.commands.kill(Number(id));
      }));
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
      this.sessions.delete(sessionId);
      return { sessionId };
    },
  };

  private trackCommand(session: E2BSessionState, state: E2BCommandState, handle: CommandHandle): void {
    state.handle = handle;
    void handle.wait().then((result) => {
      state.exitCode = result.exitCode;
      state.stdout = boundedSessionOutput(result.stdout);
      state.stderr = boundedSessionOutput(result.stderr);
    }).catch((error: unknown) => {
      state.stdout = boundedSessionOutput(handle.stdout);
      state.stderr = boundedSessionOutput(handle.stderr);
      if (error instanceof CommandExitError) {
        state.exitCode = error.exitCode;
        state.stdout = boundedSessionOutput(error.stdout);
        state.stderr = boundedSessionOutput(error.stderr);
      }
      // Losing the stream does not kill the remote process. Reattach on the next poll.
    }).finally(() => {
      state.handle = undefined;
      pruneCompletedCommands(session);
    });
  }

  private async requireCommand(sessionId: string, commandId: string): Promise<E2BCommandState> {
    this.touchSessionCache();
    const session = this.sessions.get(sessionId);
    const command = session?.commands.get(commandId);
    if (!session || !command) throw new Error(`E2B command ${commandId} was not found in session ${sessionId}.`);
    if (!command.handle && command.exitCode === undefined) {
      command.reconnecting ??= this.sdk.commands.connect(Number(commandId), {
        requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
        timeoutMs: E2B_BACKGROUND_COMMAND_TIMEOUT_MS,
      }).then((handle) => this.trackCommand(session, command, handle));
      try {
        await command.reconnecting;
      } finally {
        command.reconnecting = undefined;
      }
    }
    return command;
  }

  private async commandEnvironment(overrides?: Record<string, string>): Promise<Record<string, string> | undefined> {
    const inherited = await this.sdk.files.read(E2B_ENV_MANIFEST).then((raw) => {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => ENV_NAME_PATTERN.test(entry[0]) && typeof entry[1] === "string",
        ).map(([envName, secretName]) => [envName, Secret.fill(secretName)]),
      );
    }).catch((error: unknown) => {
      if (error instanceof FileNotFoundError) return {};
      throw error;
    });
    const merged = { ...inherited, ...overrides };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private async requiredGit(path: string, args: string, envs?: Record<string, string>) {
    const result = await runCommand(this.sdk, `git ${args}`, { cwd: path, envs });
    if (result.exitCode !== 0) throw new Error(result.stderr || `E2B git ${args.split(" ")[0]} failed.`);
    return {
      ...result,
      result: commandOutput(result.stdout, result.stderr),
    };
  }

  private async authenticatedGit(
    path: string,
    operation: "push" | "pull",
    username?: string,
    password?: string,
    remote = "origin",
    branch?: string,
    setUpstream?: boolean,
  ) {
    const envs = username && password
      ? {
          GIT_ASKPASS: "/opt/autopr/bin/autopr-git-askpass",
          GIT_TERMINAL_PROMPT: "0",
          AUTOPR_GIT_USERNAME: username,
          AUTOPR_GIT_PASSWORD: password,
        }
      : undefined;
    const upstream = operation === "push" && setUpstream ? "--set-upstream " : "";
    const target = [remote, branch].filter(Boolean).map((value) => `'${value!.replace(/'/g, "'\\''")}'`).join(" ");
    return await this.requiredGit(path, `${operation} ${upstream}${target}`.trim(), envs);
  }

  private async readRecording(id: string): Promise<E2BRecording> {
    const raw = await this.sdk.files.read(recordingMetadataPath(id));
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error(`Invalid E2B recording metadata for ${id}.`);
    return parsed as E2BRecording;
  }
}

const adapters = new Map<string, { adapter: E2BSandboxAdapter; expiresAt: number }>();
const ADAPTER_CACHE_MS = 5_000;

function pruneAdapters(now = Date.now()): void {
  for (const [sandboxId, cached] of adapters) {
    if (cached.expiresAt <= now) adapters.delete(sandboxId);
  }
  while (adapters.size > E2B_MAX_CACHED_SANDBOXES) {
    const oldest = [...adapters].sort((left, right) => left[1].expiresAt - right[1].expiresAt)[0];
    if (!oldest) break;
    adapters.delete(oldest[0]);
  }
}

export async function createE2BSandbox(options: SandboxSessionOptions = {}): Promise<E2BSandboxAdapter> {
  pruneAdapters();
  if (options.sandboxId) {
    const cached = adapters.get(options.sandboxId);
    if (cached && cached.expiresAt > Date.now()) return cached.adapter;
    const [sdk, info] = await Promise.all([
      E2BSdkSandbox.connect(options.sandboxId, {
        timeoutMs: E2B_TIMEOUT_MS,
        requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
      }),
      E2BSdkSandbox.getInfo(options.sandboxId, { requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS }),
    ]);
    const adapter = new E2BSandboxAdapter(sdk, info);
    adapters.set(options.sandboxId, { adapter, expiresAt: Date.now() + ADAPTER_CACHE_MS });
    pruneAdapters();
    return adapter;
  }

  const template = options.snapshot ?? process.env.E2B_TEMPLATE ?? DEFAULT_E2B_TEMPLATE;
  const sdk = await E2BSdkSandbox.create(template, {
    timeoutMs: E2B_TIMEOUT_MS,
    requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
    metadata: e2bMetadata(options),
    lifecycle: {
      onTimeout: { action: "pause", keepMemory: true },
      autoResume: true,
    },
    network: e2bNetwork(),
  });
  const adapter = new E2BSandboxAdapter(sdk, {
    name: options.name,
    templateId: template,
    state: "running",
    metadata: e2bMetadata(options),
  });
  adapters.set(adapter.id, { adapter, expiresAt: Date.now() + ADAPTER_CACHE_MS });
  pruneAdapters();
  return adapter;
}

export async function getE2BSandboxWithoutStarting(sandboxId: string): Promise<E2BSandboxAdapter> {
  const info = await E2BSdkSandbox.getInfo(sandboxId, { requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS });
  if (info.state !== "running") {
    throw new SandboxRuntimeNotStartedError(info.state);
  }
  const sdk = await E2BSdkSandbox.connect(sandboxId, {
    // Connecting normally renews the timeout. Status polling must not keep an idle VM alive.
    timeoutMs: 0,
    requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS,
  });
  return new E2BSandboxAdapter(sdk, info);
}

export async function deleteE2BSandbox(sandboxId: string): Promise<void> {
  try {
    await E2BSdkSandbox.kill(sandboxId, { requestTimeoutMs: E2B_REQUEST_TIMEOUT_MS });
  } catch (error) {
    if (!(error instanceof SandboxNotFoundError)) throw error;
  }
  adapters.delete(sandboxId);
  sessionsBySandbox.delete(sandboxId);
}
