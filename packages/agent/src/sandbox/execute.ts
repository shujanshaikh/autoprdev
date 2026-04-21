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
): Promise<{
  cwd: string;
  sessionId: string;
  cmdId: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  output?: string;
}> {
  const { sandbox, workDir } = await getSandboxContext(options.sandboxOptions);
  const cwd = options.cwd ?? workDir;
  const sessionId = createCommandSessionId();
  const remoteCommand = `cd ${shellQuote(cwd)} && ${prependEnvExports(command, options.env)}`;
  let keepSession = false;

  await sandbox.process.createSession(sessionId);

  try {
    const result = await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: remoteCommand,
        runAsync: options.isBackground,
        suppressInputEcho: true,
      },
      options.timeout,
    );
    keepSession = Boolean(options.isBackground);

    return {
      cwd,
      sessionId,
      cmdId: result.cmdId,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      output: "output" in result && typeof result.output === "string" ? result.output : undefined,
    };
  } finally {
    if (!keepSession) {
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
