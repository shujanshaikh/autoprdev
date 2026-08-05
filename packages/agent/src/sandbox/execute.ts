import {
  getSandboxContext,
  type DaytonaSandbox,
  type SandboxSessionOptions,
} from "./index";

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

/**
 * Thrown when an agent-facing file tool targets a path outside the sandbox
 * workspace. File tools are jailed to the workspace so prompt-injected paths
 * like `/etc/passwd` or `../../home/...` cannot read or overwrite host files.
 */
export class SandboxPathBoundaryError extends Error {
  readonly code = "sandbox_path_boundary";

  constructor(
    readonly resolvedPath: string,
    readonly allowedRoot: string,
  ) {
    super(
      `Path ${resolvedPath} is outside the sandbox workspace (${allowedRoot}). ` +
        "File tools are restricted to the workspace directory; stay inside it.",
    );
    this.name = "SandboxPathBoundaryError";
  }
}

/** Lexical containment check: candidate must equal root or live under it. */
export function isPathWithinRoot(candidatePath: string, root: string): boolean {
  const candidate = normalizePosixPath(toPosixPath(candidatePath));
  const normalizedRoot = normalizePosixPath(toPosixPath(root)).replace(/\/+$/, "") || "/";

  if (normalizedRoot === "/") {
    return candidate.startsWith("/");
  }

  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);
}

/**
 * Canonicalizes paths on the sandbox host (symlinks resolved) without
 * requiring the paths to exist. Falls back to lexical normalization when the
 * sandbox image has no canonicalization tool.
 */
async function canonicalizeRemotePaths(
  paths: string[],
  sandboxOptions?: SandboxSessionOptions,
): Promise<string[]> {
  const quotedPaths = paths.map((path) => shellQuote(path)).join(" ");
  const command =
    `for p in ${quotedPaths}; do ` +
    `if command -v realpath >/dev/null 2>&1; then realpath -m -- "$p"; ` +
    `elif command -v readlink >/dev/null 2>&1; then readlink -m -- "$p"; ` +
    `else printf '%s\\n' "$p"; fi; done`;
  const result = await executeSandboxCommand(command, {
    cwd: "/",
    timeout: 30,
    sandboxOptions,
  });

  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(
      `Could not canonicalize sandbox paths: ${result.stderr ?? result.output ?? "unknown error"}`,
    );
  }

  const output = result.stdout ?? result.output ?? "";
  const lines = output.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  if (lines.length !== paths.length) {
    throw new Error("Could not canonicalize sandbox paths: unexpected sandbox output.");
  }

  return lines;
}

const canonicalRootCache = new WeakMap<
  DaytonaSandbox,
  Map<string, Promise<string[]>>
>();

async function canonicalizeRemoteRoots(
  roots: string[],
  sandboxOptions?: SandboxSessionOptions,
) {
  const { sandbox } = await getSandboxContext(sandboxOptions);
  let sandboxCache = canonicalRootCache.get(sandbox);
  if (!sandboxCache) {
    sandboxCache = new Map();
    canonicalRootCache.set(sandbox, sandboxCache);
  }
  const key = JSON.stringify(roots);
  const cached = sandboxCache.get(key);
  if (cached) return cached;

  const pending = canonicalizeRemotePaths(roots, sandboxOptions);
  sandboxCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    if (sandboxCache.get(key) === pending) sandboxCache.delete(key);
    throw error;
  }
}

export interface ResolveJailedSandboxPathOptions {
  workDir: string;
  sandboxOptions?: SandboxSessionOptions;
  /** Extra absolute roots (beyond workDir) that file tools may touch. */
  extraAllowedRoots?: string[];
}

/**
 * Resolves an agent-supplied path and enforces the workspace jail: the
 * resolved path must be the workspace root (or an explicit extra root) or
 * live beneath it. The candidate and the roots are canonicalized on the
 * sandbox host first, so symlinks inside the workspace cannot be used to
 * escape it.
 */
export async function resolveJailedSandboxPath(
  inputPath: string | undefined,
  options: ResolveJailedSandboxPathOptions,
): Promise<string> {
  const candidate = resolveSandboxPath(inputPath, options.workDir);

  if (candidate.includes("\n") || candidate.includes("\r")) {
    throw new SandboxPathBoundaryError(candidate, options.workDir);
  }

  const roots = [options.workDir, ...(options.extraAllowedRoots ?? [])].map((root) =>
    resolveSandboxPath(root, options.workDir),
  );

  // Lexical fast path: reject obvious escapes without a sandbox round trip.
  if (!roots.some((root) => isPathWithinRoot(candidate, root))) {
    throw new SandboxPathBoundaryError(candidate, options.workDir);
  }

  // Canonical check: a symlink inside the workspace can still point outside
  // it, so compare realpath output before trusting the candidate.
  const [canonicalRoots, canonicalCandidates] = await Promise.all([
    canonicalizeRemoteRoots(roots, options.sandboxOptions),
    canonicalizeRemotePaths([candidate], options.sandboxOptions),
  ]);
  const canonicalCandidate = canonicalCandidates[0]!;

  if (!canonicalRoots.some((root) => isPathWithinRoot(canonicalCandidate, root))) {
    throw new SandboxPathBoundaryError(candidate, options.workDir);
  }

  return candidate;
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

const REMOTE_FILE_MISSING_EXIT_CODE = 43;
const DEFAULT_DOWNLOAD_TIMEOUT_SECONDS = 60;

/** Thrown when a remote download targets a path that does not exist. */
export class RemoteFileNotFoundError extends Error {
  constructor(readonly remotePath: string) {
    super(`Remote file not found: ${remotePath}`);
    this.name = "RemoteFileNotFoundError";
  }
}

export interface DownloadRemoteFileChunkOptions {
  remotePath: string;
  /** Hard cap on bytes transferred to the harness; enforced on the sandbox host. */
  maxBytes: number;
  /** 1-based first line to transfer. Requires endLine. Omit for a byte prefix. */
  startLine?: number;
  /** 1-based inclusive last line to transfer. Requires startLine. */
  endLine?: number;
  /** Bytes to skip within the selected line window before applying maxBytes. */
  skipBytes?: number;
  /** Also count the file's lines remotely (returned as totalLines). */
  countLines?: boolean;
  timeout?: number;
  sandboxOptions?: SandboxSessionOptions;
}

export interface RemoteFileChunk {
  /** At most maxBytes of file content. */
  content: Buffer;
  /** Full file size in bytes, measured remotely without transferring it. */
  totalBytes: number;
  /** Newline count from `wc -l` when countLines was requested. */
  totalLines?: number;
  /** True when content hit maxBytes and more of the requested range may remain. */
  reachedMaxBytes: boolean;
}

function parseChunkMetaLine(line: string): number[] {
  const numbers = line
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10));

  if (numbers.length === 0 || numbers.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Could not parse sandbox download metadata: ${line}`);
  }

  return numbers;
}

/**
 * Downloads a byte-capped chunk of a remote file without ever buffering the
 * whole file in harness memory. Stats and the (base64-wrapped) payload are
 * produced by a single sandbox command so `head -c` caps the bytes on the
 * host before anything is transferred.
 */
export async function downloadRemoteFileChunk(
  options: DownloadRemoteFileChunkOptions,
): Promise<RemoteFileChunk> {
  if (!Number.isFinite(options.maxBytes) || options.maxBytes < 1) {
    throw new Error(`Invalid download byte cap: ${options.maxBytes}`);
  }

  if ((options.startLine === undefined) !== (options.endLine === undefined)) {
    throw new Error("startLine and endLine must be provided together.");
  }
  if (options.skipBytes !== undefined && (!Number.isFinite(options.skipBytes) || options.skipBytes < 0)) {
    throw new Error(`Invalid download byte offset: ${options.skipBytes}`);
  }

  if (options.remotePath.includes("\n") || options.remotePath.includes("\r")) {
    throw new Error(`Invalid remote path: ${options.remotePath}`);
  }

  const maxBytes = Math.floor(options.maxBytes);
  const quotedPath = shellQuote(options.remotePath);
  const guard =
    `if [ ! -e ${quotedPath} ]; then ` +
    `printf '%s\\n' ${shellQuote(`remote file not found: ${options.remotePath}`)} >&2; ` +
    `exit ${REMOTE_FILE_MISSING_EXIT_CODE}; fi`;
  const stats = options.countLines ? `wc -l -c < ${quotedPath}` : `wc -c < ${quotedPath}`;
  const selected = options.startLine !== undefined
    ? `sed -n ${shellQuote(`${options.startLine},${options.endLine}p`)} -- ${quotedPath}`
    : undefined;
  const skipped = options.skipBytes
    ? `${selected ?? `cat -- ${quotedPath}`} | tail -c +${Math.floor(options.skipBytes) + 1}`
    : selected;
  const payload = skipped
    ? `${skipped} | head -c ${maxBytes} | base64 | tr -d '\\n'`
    : `head -c ${maxBytes} -- ${quotedPath} | base64 | tr -d '\\n'`;
  const command = `${guard}; ${stats}; ${payload}`;

  const result = await executeSandboxCommand(command, {
    cwd: "/",
    timeout: options.timeout ?? DEFAULT_DOWNLOAD_TIMEOUT_SECONDS,
    sandboxOptions: options.sandboxOptions,
  });

  if (result.exitCode === REMOTE_FILE_MISSING_EXIT_CODE) {
    throw new RemoteFileNotFoundError(options.remotePath);
  }

  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(
      `Could not download ${options.remotePath}: ${result.stderr ?? result.output ?? "unknown error"}`,
    );
  }

  const output = result.stdout ?? result.output ?? "";
  const separatorIndex = output.indexOf("\n");
  const metaLine = separatorIndex === -1 ? output : output.slice(0, separatorIndex);
  const base64Payload = separatorIndex === -1 ? "" : output.slice(separatorIndex + 1);
  const numbers = parseChunkMetaLine(metaLine);
  const expectedMetaCount = options.countLines ? 2 : 1;

  if (numbers.length !== expectedMetaCount) {
    throw new Error(`Could not parse sandbox download metadata: ${metaLine}`);
  }

  const content = base64Payload ? Buffer.from(base64Payload, "base64") : Buffer.alloc(0);

  return {
    content,
    totalBytes: options.countLines ? numbers[1]! : numbers[0]!,
    totalLines: options.countLines ? numbers[0] : undefined,
    reachedMaxBytes: content.length >= maxBytes,
  };
}
