import { getSandboxContext, type SandboxSessionOptions } from "./index";

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function normalizePosixPath(input: string): string {
  const isAbsolute = input.startsWith("/");
  const stack: string[] = [];

  for (const part of input.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }

    stack.push(part);
  }

  const output = stack.join("/");
  return isAbsolute ? `/${output}` : output || ".";
}

function joinPosix(base: string, relativePath: string): string {
  const cleanBase = base.replace(/\/+$/, "") || "/";
  const cleanRelative = toPosixPath(relativePath);

  if (cleanRelative.startsWith("/")) {
    return normalizePosixPath(cleanRelative);
  }

  if (cleanBase === "/") {
    return normalizePosixPath(`/${cleanRelative}`);
  }

  return normalizePosixPath(`${cleanBase}/${cleanRelative}`);
}

function posixDirname(path: string): string {
  const normalized = normalizePosixPath(toPosixPath(path)).replace(/\/+$/, "");

  if (normalized === "" || normalized === ".") {
    return ".";
  }

  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex === -1) {
    return ".";
  }

  if (slashIndex === 0) {
    return "/";
  }

  return normalized.slice(0, slashIndex) || "/";
}

function createCommandSessionId(): string {
  return `autopr-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const DAYTONA_TIMEOUT_ERROR_NAME = "DaytonaTimeoutError";
const COMMAND_TIMEOUT_EXIT_CODE = 124;
const COMMAND_TIMEOUT_GRACE_SECONDS = 5;
const BACKGROUND_COMMAND_START_TIMEOUT_SECONDS = 15;

export interface SandboxCommandResult {
  cwd: string;
  sessionId: string;
  cmdId?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  output?: string;
  timedOut?: boolean;
  timeout?: number;
}

function normalizeCommandTimeout(timeout: number | undefined): number | undefined {
  if (timeout === undefined) {
    return undefined;
  }

  if (!Number.isFinite(timeout) || timeout < 1) {
    throw new Error(`Invalid command timeout: ${timeout}`);
  }

  return Math.ceil(timeout);
}

function isDaytonaTimeoutError(error: unknown): error is Error {
  return error instanceof Error && error.name === DAYTONA_TIMEOUT_ERROR_NAME;
}

function buildTimedCommand(command: string, timeout: number): string {
  const script = shellQuote(command);
  const duration = shellQuote(`${timeout}s`);

  return `if command -v timeout >/dev/null 2>&1; then timeout ${duration} bash -lc ${script}; else bash -lc ${script}; fi`;
}

function formatTimeoutMessage(timeout: number | undefined): string {
  if (timeout) {
    return `Command timed out after ${timeout} second${timeout === 1 ? "" : "s"}.`;
  }

  return "Daytona timed out while waiting for the command to finish.";
}

export function resolveSandboxPath(inputPath: string | undefined, sandboxWorkDir: string): string {
  const workDir = normalizePosixPath(toPosixPath(sandboxWorkDir));

  if (!inputPath || inputPath === ".") {
    return workDir;
  }

  const path = toPosixPath(inputPath);
  return path.startsWith("/") ? normalizePosixPath(path) : joinPosix(workDir, path);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function prependEnvExports(command: string, env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) {
    return command;
  }

  const validKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const exportStatements = Object.entries(env).map(([key, value]) => {
    if (!validKeyPattern.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }

    return `export ${key}=${shellQuote(value)}`;
  });

  return `${exportStatements.join("; ")}; ${command}`;
}

export async function executeSandboxCommand(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
    isBackground?: boolean;
    sandboxOptions?: SandboxSessionOptions;
  } = {},
): Promise<SandboxCommandResult> {
  const { sandbox, workDir } = await getSandboxContext(options.sandboxOptions);
  const cwd = options.cwd ?? workDir;
  const sessionId = createCommandSessionId();
  const requestedTimeout = normalizeCommandTimeout(options.timeout);
  const isBackground = Boolean(options.isBackground);
  const commandTimeout = isBackground ? undefined : requestedTimeout;
  const commandWithEnv = prependEnvExports(command, options.env);
  const remoteCommandBody = commandTimeout ? buildTimedCommand(commandWithEnv, commandTimeout) : commandWithEnv;
  const remoteCommand = `cd ${shellQuote(cwd)} && ${remoteCommandBody}`;
  const sdkTimeout = isBackground
    ? BACKGROUND_COMMAND_START_TIMEOUT_SECONDS
    : commandTimeout
      ? commandTimeout + COMMAND_TIMEOUT_GRACE_SECONDS
      : requestedTimeout;

  await sandbox.process.createSession(sessionId);

  try {
    const result = await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: remoteCommand,
        runAsync: isBackground,
        suppressInputEcho: true,
      },
      sdkTimeout,
    );

    return {
      cwd,
      sessionId,
      cmdId: result.cmdId,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      output: "output" in result && typeof result.output === "string" ? result.output : undefined,
      timedOut: commandTimeout !== undefined && result.exitCode === COMMAND_TIMEOUT_EXIT_CODE,
      timeout: commandTimeout,
    };
  } catch (error) {
    if (!isDaytonaTimeoutError(error)) {
      throw error;
    }

    const message = formatTimeoutMessage(commandTimeout);

    return {
      cwd,
      sessionId,
      exitCode: COMMAND_TIMEOUT_EXIT_CODE,
      stderr: message,
      output: message,
      timedOut: true,
      timeout: commandTimeout,
    };
  } finally {
    if (!isBackground) {
      await sandbox.process.deleteSession(sessionId).catch(() => undefined);
    }
  }
}

export async function ensureRemoteParentDirectory(
  remotePath: string,
  sandboxOptions?: SandboxSessionOptions,
): Promise<void> {
  await executeSandboxCommand(`mkdir -p ${shellQuote(posixDirname(remotePath))}`, {
    cwd: "/",
    timeout: 60,
    sandboxOptions,
  });
}
