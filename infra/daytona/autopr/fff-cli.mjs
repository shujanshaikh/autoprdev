#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FileFinder, findBinary } from "@ff-labs/fff-node";

const DEFAULT_HOME = "/home";
const DEFAULT_LIMIT = 50;
const DEFAULT_INDEX_TIMEOUT_MS = 10_000;
const DEFAULT_GREP_TIME_BUDGET_MS = 10_000;
const DEFAULT_DAEMON_IDLE_TIMEOUT_MS = 5 * 60_000;
const DAEMON_START_TIMEOUT_MS = 5_000;
const DAEMON_REQUEST_TIMEOUT_MS = 40_000;
const MAX_DAEMON_REQUEST_BYTES = 1024 * 1024;
const MAX_DAEMON_RESPONSE_BYTES = 16 * 1024 * 1024;
const FIND_WEAK_SAMPLE_SIZE = 5;
const CLI_PATH = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "health";
  const flags = new Map();
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const equalsIndex = value.indexOf("=");
    if (equalsIndex !== -1) {
      flags.set(value.slice(0, equalsIndex), value.slice(equalsIndex + 1));
      continue;
    }

    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(value, next);
      index += 1;
      continue;
    }

    flags.set(value, "true");
  }

  return { command, flags, positionals };
}

function readFlag(parsed, name, fallback) {
  return parsed.flags.get(name) ?? fallback;
}

function readNumberFlag(parsed, name, fallback) {
  const raw = readFlag(parsed, name, undefined);
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBooleanFlag(parsed, name, fallback) {
  const raw = readFlag(parsed, name, undefined);
  if (raw === undefined) {
    return fallback;
  }

  if (raw === "true" || raw === "1" || raw === "yes") {
    return true;
  }

  if (raw === "false" || raw === "0" || raw === "no") {
    return false;
  }

  return fallback;
}

function defaultCwd() {
  if (process.env.DAYTONA_WORKDIR) {
    return process.env.DAYTONA_WORKDIR;
  }

  try {
    const repoDir = fs
      .readdirSync(DEFAULT_HOME, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(DEFAULT_HOME, entry.name))
      .find((candidate) => fs.existsSync(path.join(candidate, ".git")));

    return repoDir ?? DEFAULT_HOME;
  } catch {
    return DEFAULT_HOME;
  }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(raw, expectedType) {
  if (!raw) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (decoded && decoded.type === expectedType) {
      return decoded;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasRegexSyntax(value) {
  return escapeRegex(value) !== value;
}

function isValidRegex(value) {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

function resolveFindMode(mode) {
  if (mode && mode !== "auto") {
    return mode;
  }

  return "fuzzy";
}

function resolveGrepMode(mode, pattern) {
  if (mode === "plain" || mode === "regex" || mode === "fuzzy") {
    return mode;
  }

  return hasRegexSyntax(pattern) && isValidRegex(pattern) ? "regex" : "plain";
}

function isWildcardOnlyPattern(pattern) {
  const trimmed = pattern.trim();
  if (!trimmed || !hasRegexSyntax(trimmed)) {
    return false;
  }

  return /^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.\*\??|\.\*[+?]?|\.\+\??|\.|\*|\?)$/.test(
    trimmed,
  );
}

function cleanupFuzzyQuery(value) {
  let output = "";
  for (const char of value) {
    if (char !== ":" && char !== "-" && char !== "_") {
      output += char.toLowerCase();
    }
  }
  return output;
}

function normalizePathConstraint(pathConstraint, cwd = process.cwd()) {
  let trimmed = pathConstraint.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (path.isAbsolute(trimmed)) {
    const relative = path.relative(cwd, trimmed).replaceAll(path.sep, "/");
    if (relative === "") {
      return null;
    }
    if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
      throw new Error(`Path constraint must be inside the search root: ${pathConstraint}`);
    }
    trimmed = relative;
  }

  if (trimmed === "." || trimmed === "./") {
    return null;
  }
  if (trimmed.startsWith("./")) {
    trimmed = trimmed.slice(2);
  }

  if (trimmed === "**" || trimmed === "**/" || trimmed === "**/*") {
    return null;
  }

  const recursiveDir = trimmed.match(/^(.*)\/\*\*(?:\/\*)?$/);
  if (recursiveDir) {
    const dir = recursiveDir[1];
    if (dir && !/[*?[{]/.test(dir)) {
      return `${dir}/`;
    }
  }

  if (trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return trimmed;
  }
  if (/[*?[{]/.test(trimmed)) {
    return trimmed;
  }

  const lastSegment = trimmed.split("/").pop() ?? "";
  if (/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSegment)) {
    return trimmed;
  }

  return `${trimmed}/`;
}

function normalizeExcludes(exclude, cwd = process.cwd()) {
  if (!exclude) {
    return [];
  }

  const output = [];
  for (const part of String(exclude).split(/[,\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const stripped = trimmed.startsWith("!") ? trimmed.slice(1) : trimmed;
    const normalized = normalizePathConstraint(stripped, cwd);
    if (normalized) {
      output.push(`!${normalized}`);
    }
  }

  return output;
}

function buildQuery({ cwd, path: pathConstraint, glob, pattern, exclude }) {
  const parts = [];

  for (const constraint of [pathConstraint, glob]) {
    if (!constraint) {
      continue;
    }
    const normalized = normalizePathConstraint(String(constraint), cwd);
    if (normalized) {
      parts.push(normalized);
    }
  }

  parts.push(...normalizeExcludes(exclude, cwd));
  if (pattern) {
    parts.push(pattern);
  }

  return parts.join(" ");
}

function weakScoreThreshold(pattern) {
  return Math.floor(pattern.length * 12 * 0.5);
}

function summarizeFindQuality(result, pattern) {
  const topScore = result.scores?.[0]?.total ?? 0;
  return {
    weak: pattern.length > 0 && topScore < weakScoreThreshold(pattern),
  };
}

function withFindCursor(result, cursorInput) {
  const pageIndex = cursorInput.pageIndex;
  const pageSize = cursorInput.pageSize;
  const shownSoFar = pageIndex * pageSize + result.items.length;

  if (result.items.length >= pageSize && result.totalMatched > shownSoFar) {
    return {
      ...result,
      nextCursor: encodeCursor({
        type: "find",
        query: cursorInput.query,
        pattern: cursorInput.pattern,
        mode: cursorInput.mode,
        pageSize,
        pageIndex: pageIndex + 1,
      }),
    };
  }

  return {
    ...result,
    nextCursor: null,
  };
}

function withGrepCursor(result) {
  const offset = result.nextCursor?._offset;
  return {
    ...result,
    nextCursor:
      Number.isFinite(offset)
        ? encodeCursor({
            type: "grep",
            offset,
          })
        : null,
  };
}

async function waitForIndex(finder, timeoutMs) {
  const waiter =
    finder.waitForIndexReady instanceof Function
      ? finder.waitForIndexReady.bind(finder)
      : finder.waitForScan.bind(finder);
  const ready = await waiter(timeoutMs);
  if (!ready.ok) {
    throw new Error(ready.error);
  }

  return ready.value === true;
}

function workspaceHash(cwd) {
  return crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

function canonicalizeCwd(cwd) {
  const resolved = path.resolve(cwd);
  let canonical;
  try {
    canonical = fs.realpathSync(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`FFF workspace does not exist: ${resolved}`);
    }
    throw error;
  }

  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error(`FFF workspace is not a directory: ${canonical}`);
  }
  return canonical;
}

function workspaceDatabasePath(configuredPath, cwd) {
  if (!configuredPath) {
    return undefined;
  }

  const parsed = path.parse(configuredPath);
  return path.join(parsed.dir, `${parsed.name}-${workspaceHash(cwd)}${parsed.ext}`);
}

function createFinder(cwd) {
  const created = FileFinder.create({
    basePath: cwd,
    aiMode: true,
    frecencyDbPath: workspaceDatabasePath(process.env.FFF_FRECENCY_DB, cwd),
    historyDbPath: workspaceDatabasePath(process.env.FFF_HISTORY_DB, cwd),
  });

  if (!created.ok) {
    throw new Error(created.error);
  }

  return created.value;
}

async function withFinder(cwd, parsed, callback, providedFinder) {
  const finder = providedFinder ?? createFinder(cwd);

  try {
    const timeoutMs = readNumberFlag(parsed, "--index-timeout-ms", DEFAULT_INDEX_TIMEOUT_MS);
    await waitForIndex(finder, timeoutMs);

    return await callback(finder);
  } finally {
    if (!providedFinder) {
      finder.destroy();
    }
  }
}

async function runCommand(parsed, providedFinder) {
  const { command, positionals } = parsed;
  const cwd = canonicalizeCwd(
    readFlag(parsed, "--cwd", process.cwd() === "/" ? defaultCwd() : process.cwd()),
  );

  if (command === "health") {
    const binary = findBinary();
    const result = await withFinder(cwd, parsed, async (finder) => {
      const health = finder.healthCheck(cwd);
      const progress = finder.getScanProgress();

      return {
        ok: health.ok && progress.ok,
        cwd,
        binary,
        health: health.ok ? health.value : { error: health.error },
        progress: progress.ok ? progress.value : { error: progress.error },
      };
    }, providedFinder);

    return result;
  }

  if (command === "find") {
    const decodedCursor = decodeCursor(readFlag(parsed, "--cursor", ""), "find");
    const rawPattern = readFlag(parsed, "--query", positionals[0]);
    if (!rawPattern && !decodedCursor) {
      throw new Error("Missing --query for find");
    }

    const limit = decodedCursor?.pageSize ?? readNumberFlag(parsed, "--limit", DEFAULT_LIMIT);
    const requestedMode = readFlag(parsed, "--mode", "auto");
    const rawQuery = rawPattern ?? decodedCursor.pattern;
    const mode = decodedCursor?.mode ?? resolveFindMode(requestedMode);
    const pageIndex = decodedCursor?.pageIndex ?? 0;
    const result = await withFinder(cwd, parsed, async (finder) => {
      const pathConstraint = readFlag(parsed, "--path", "");
      const exclude = readFlag(parsed, "--exclude", "");
      const query =
        decodedCursor?.query ??
        buildQuery({
          cwd,
          path: pathConstraint,
          pattern: rawQuery,
          exclude,
        });
      const options = { pageIndex, pageSize: limit };
      const search =
        mode === "glob"
          ? finder.glob(query, options)
          : mode === "directory" || mode === "directories"
            ? finder.directorySearch(query, options)
            : mode === "mixed"
              ? finder.mixedSearch(query, options)
              : finder.fileSearch(query, options);

      if (!search.ok) {
        throw new Error(search.error);
      }

      let value = search.value;
      let effectiveQuery = query;
      let autoBroadenedFrom;

      const words = rawQuery.split(/\s+/).filter(Boolean);
      if (mode === "fuzzy" && pageIndex === 0 && value.items.length === 0 && words.length >= 3) {
        const shorterPattern = words.slice(0, 2).join(" ");
        const shorterQuery = buildQuery({
          cwd,
          path: pathConstraint,
          pattern: shorterPattern,
          exclude,
        });
        const retry = finder.fileSearch(shorterQuery, options);
        if (retry.ok && retry.value.items.length > 0) {
          value = retry.value;
          effectiveQuery = shorterQuery;
          autoBroadenedFrom = rawQuery;
        }
      }

      const quality = summarizeFindQuality(value, rawQuery);
      const paginatedValue = withFindCursor(value, {
        query: effectiveQuery,
        pattern: rawQuery,
        mode,
        pageSize: limit,
        pageIndex,
      });
      const cursorResult = quality.weak
        ? {
            ...paginatedValue,
            items: paginatedValue.items.slice(0, FIND_WEAK_SAMPLE_SIZE),
            scores: paginatedValue.scores?.slice(0, FIND_WEAK_SAMPLE_SIZE),
            nextCursor: null,
          }
        : paginatedValue;

      return {
        ok: true,
        cwd,
        query: effectiveQuery,
        pattern: rawQuery,
        mode,
        pageIndex,
        autoBroadenedFrom,
        weak: quality.weak,
        ...cursorResult,
      };
    }, providedFinder);

    return result;
  }

  if (command === "grep") {
    const pattern = readFlag(parsed, "--pattern", positionals[0]);
    if (!pattern) {
      throw new Error("Missing --pattern for grep");
    }
    if (isWildcardOnlyPattern(pattern)) {
      throw new Error(
        `Pattern '${pattern}' matches everything. grep requires a concrete substring or identifier; use read for a known file or find for file discovery.`,
      );
    }

    const limit = readNumberFlag(parsed, "--limit", DEFAULT_LIMIT);
    const requestedMode = readFlag(parsed, "--mode", "auto");
    const glob = readFlag(parsed, "--glob", "");
    const context = readNumberFlag(parsed, "--context", 0);
    const beforeContext = readNumberFlag(parsed, "--before-context", context);
    const afterContext = readNumberFlag(parsed, "--after-context", context);
    const ignoreCase = readBooleanFlag(parsed, "--ignore-case", false);
    const caseSensitive = readBooleanFlag(parsed, "--case-sensitive", false);
    const maxMatchesPerFile = readNumberFlag(parsed, "--max-matches-per-file", Math.min(limit, 50));
    const timeBudgetMs = readNumberFlag(
      parsed,
      "--time-budget-ms",
      DEFAULT_GREP_TIME_BUDGET_MS,
    );
    const cursor = decodeCursor(readFlag(parsed, "--cursor", ""), "grep");
    const result = await withFinder(cwd, parsed, async (finder) => {
      const effectiveMode = resolveGrepMode(requestedMode, pattern);
      const forceIgnoreCase = ignoreCase && !caseSensitive;
      const searchPattern =
        forceIgnoreCase && effectiveMode === "regex"
          ? `(?i:${pattern})`
          : forceIgnoreCase
            ? pattern.toLowerCase()
            : pattern;
      const pathConstraint = readFlag(parsed, "--path", "");
      const exclude = readFlag(parsed, "--exclude", "");
      const query = buildQuery({
        cwd,
        path: pathConstraint,
        glob,
        pattern: searchPattern,
        exclude,
      });
      const smartCase = caseSensitive ? false : true;
      const search = finder.grep(query, {
        mode: effectiveMode,
        smartCase,
        maxMatchesPerFile,
        cursor: cursor ? { __brand: "GrepCursor", _offset: cursor.offset } : null,
        beforeContext,
        afterContext,
        pageSize: limit,
        classifyDefinitions: true,
        timeBudgetMs,
      });
      if (!search.ok) {
        throw new Error(search.error);
      }

      let value = search.value;
      let effectiveQuery = query;
      let fallback;

      const words = pattern.split(/\s+/).filter(Boolean);
      if (value.items.length === 0 && !value.nextCursor && !cursor && words.length >= 2) {
        const restPattern = words.slice(1).join(" ");
        const retryPattern =
          forceIgnoreCase && effectiveMode === "regex"
            ? `(?i:${restPattern})`
            : forceIgnoreCase
              ? restPattern.toLowerCase()
              : restPattern;
        const retryMode = resolveGrepMode(requestedMode, restPattern);
        const retryQuery = buildQuery({
          cwd,
          path: pathConstraint,
          glob,
          pattern: retryPattern,
          exclude,
        });
        const retry = finder.grep(retryQuery, {
          mode: retryMode,
          smartCase,
          maxMatchesPerFile,
          beforeContext,
          afterContext,
          pageSize: limit,
          classifyDefinitions: true,
          timeBudgetMs,
        });

        if (retry.ok && retry.value.items.length > 0 && retry.value.items.length <= 10) {
          value = retry.value;
          effectiveQuery = retryQuery;
          fallback = {
            type: "auto-broaden",
            from: pattern,
            to: restPattern,
          };
        }
      }

      if (
        value.items.length === 0 &&
        !value.nextCursor &&
        !cursor &&
        effectiveMode === "plain"
      ) {
        const fuzzyPattern = cleanupFuzzyQuery(pattern);
        const lastPathSegment = pathConstraint.split(/[\\/]/).pop() ?? "";
        const pathTargetsFile = /\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastPathSegment);
        const fuzzyQuery = buildQuery({
          cwd,
          path: pathTargetsFile ? "" : pathConstraint,
          glob,
          pattern: fuzzyPattern,
          exclude,
        });
        const fuzzy = finder.grep(fuzzyQuery, {
          mode: "fuzzy",
          smartCase,
          maxMatchesPerFile,
          beforeContext: 0,
          afterContext: 0,
          pageSize: Math.min(limit, 10),
          classifyDefinitions: true,
          timeBudgetMs,
        });

        if (fuzzy.ok && fuzzy.value.items.length > 0) {
          value = fuzzy.value;
          effectiveQuery = fuzzyQuery;
          fallback = {
            type: "fuzzy",
            from: pattern,
            to: fuzzyPattern,
          };
        }
      }

      return {
        ok: true,
        cwd,
        pattern,
        query: effectiveQuery,
        glob: glob || undefined,
        mode: effectiveMode,
        ignoreCase,
        caseSensitive,
        fallback,
        ...withGrepCursor(value),
      };
    }, providedFinder);

    return result;
  }

  throw new Error(`Unknown command: ${command}`);
}

function daemonPaths(cwd) {
  const runtimeDirectory = path.join(os.tmpdir(), `autopr-fff-${process.getuid?.() ?? "user"}`);
  const id = workspaceHash(cwd);
  return {
    runtimeDirectory,
    socketPath: path.join(runtimeDirectory, `${id}.sock`),
    lockPath: path.join(runtimeDirectory, `${id}.lock`),
  };
}

function ensurePrivateRuntimeDirectory(runtimeDirectory) {
  fs.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(runtimeDirectory, 0o700);
}

function requestDaemon(socketPath, args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let response = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    socket.setTimeout(DAEMON_REQUEST_TIMEOUT_MS, () => {
      finish(new Error("Timed out waiting for the fff daemon."));
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => {
      finish(new Error("The fff daemon closed the connection before it returned a response."));
    });
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ args })}\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > MAX_DAEMON_RESPONSE_BYTES) {
        finish(new Error("fff daemon response exceeded the safety limit."));
        return;
      }

      const newline = response.indexOf("\n");
      if (newline === -1) {
        return;
      }

      try {
        const payload = JSON.parse(response.slice(0, newline));
        if (payload && payload.ok === true && payload.result) {
          finish(undefined, payload.result);
          return;
        }
        const error = new Error(payload?.error || "fff daemon returned an invalid response.");
        error.code = "AUTOPR_FFF_COMMAND_ERROR";
        finish(error);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function removeStaleLock(lockPath) {
  try {
    const recordedPid = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (Number.isInteger(recordedPid) && recordedPid > 0) {
      try {
        process.kill(recordedPid, 0);
        return false;
      } catch (error) {
        if (error?.code === "EPERM") {
          return false;
        }
      }
    }

    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (ageMs > DAEMON_START_TIMEOUT_MS * 2) {
      fs.unlinkSync(lockPath);
      return true;
    }
  } catch {
    return true;
  }

  return false;
}

function startDaemon(cwd, paths) {
  ensurePrivateRuntimeDirectory(paths.runtimeDirectory);

  let ownsLock = false;
  try {
    const descriptor = fs.openSync(paths.lockPath, "wx", 0o600);
    fs.closeSync(descriptor);
    ownsLock = true;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  if (!ownsLock) {
    return false;
  }

  try {
    const child = spawn(
      process.execPath,
      [
        CLI_PATH,
        "daemon",
        "--cwd",
        cwd,
        "--socket",
        paths.socketPath,
        "--idle-timeout-ms",
        String(DEFAULT_DAEMON_IDLE_TIMEOUT_MS),
      ],
      {
        detached: true,
        env: { ...process.env, AUTOPR_FFF_DAEMON: "0" },
        stdio: "ignore",
      },
    );
    child.unref();
    return true;
  } catch (error) {
    try {
      fs.unlinkSync(paths.lockPath);
    } catch {
      // Another process may have already recovered this startup lock.
    }
    throw error;
  }
}

async function runViaDaemon(cwd, args) {
  const paths = daemonPaths(cwd);

  try {
    return await requestDaemon(paths.socketPath, args);
  } catch (error) {
    if (error?.code === "AUTOPR_FFF_COMMAND_ERROR") {
      throw error;
    }
    if (!startDaemon(cwd, paths) && removeStaleLock(paths.lockPath)) {
      startDaemon(cwd, paths);
    }
  }

  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
  let lastError = new Error("fff daemon did not start.");
  while (Date.now() < deadline) {
    try {
      return await requestDaemon(paths.socketPath, args);
    } catch (error) {
      if (error?.code === "AUTOPR_FFF_COMMAND_ERROR") {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw lastError;
}

async function serveDaemon(parsed) {
  const cwd = canonicalizeCwd(readFlag(parsed, "--cwd", defaultCwd()));
  const expectedPaths = daemonPaths(cwd);
  const socketPath = readFlag(parsed, "--socket", expectedPaths.socketPath);
  if (socketPath !== expectedPaths.socketPath) {
    throw new Error("Invalid fff daemon socket path.");
  }

  ensurePrivateRuntimeDirectory(expectedPaths.runtimeDirectory);
  try {
    fs.unlinkSync(socketPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const finder = createFinder(cwd);
  const server = net.createServer();
  const idleTimeoutMs = readNumberFlag(
    parsed,
    "--idle-timeout-ms",
    DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
  );
  let idleTimer;
  let commandQueue = Promise.resolve();
  let closing = false;

  const cleanup = () => {
    if (closing) {
      return;
    }
    closing = true;
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    server.close();
    finder.destroy();
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // The socket can already be gone during shutdown.
    }
    try {
      fs.unlinkSync(expectedPaths.lockPath);
    } catch {
      // The startup lock can already be gone during shutdown.
    }
  };
  const resetIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      cleanup();
      process.exit(0);
    }, idleTimeoutMs);
    idleTimer.unref();
  };

  server.on("connection", (socket) => {
    resetIdleTimer();
    let request = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      request += chunk;
      if (request.length > MAX_DAEMON_REQUEST_BYTES) {
        socket.end(`${JSON.stringify({ ok: false, error: "fff daemon request exceeded the safety limit." })}\n`);
        return;
      }

      const newline = request.indexOf("\n");
      if (newline === -1) {
        return;
      }

      const rawRequest = request.slice(0, newline);
      request = "";
      commandQueue = commandQueue
        .then(async () => {
          resetIdleTimer();
          const payload = JSON.parse(rawRequest);
          if (
            !Array.isArray(payload?.args) ||
            payload.args.some((arg) => arg?.constructor !== String)
          ) {
            throw new Error("Invalid fff daemon request.");
          }
          const requestParsed = parseArgs([process.execPath, CLI_PATH, ...payload.args]);
          if (requestParsed.command === "daemon") {
            throw new Error("Nested daemon commands are not allowed.");
          }
          const requestCwd = canonicalizeCwd(readFlag(requestParsed, "--cwd", cwd));
          if (requestCwd !== cwd) {
            throw new Error("fff daemon request does not match its workspace root.");
          }
          return runCommand(requestParsed, finder);
        })
        .then(
          (result) => socket.end(`${JSON.stringify({ ok: true, result })}\n`),
          (error) =>
            socket.end(
              `${JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              })}\n`,
            ),
        );
    });
    socket.on("error", () => {
      socket.destroy();
    });
  });

  const shutdown = () => {
    cleanup();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      fs.chmodSync(socketPath, 0o600);
      fs.writeFileSync(expectedPaths.lockPath, `${process.pid}\n`, { mode: 0o600 });
      resetIdleTimer();
      resolve();
    });
  });
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.command === "daemon") {
    try {
      await serveDaemon(parsed);
    } catch (error) {
      const cwd = canonicalizeCwd(readFlag(parsed, "--cwd", defaultCwd()));
      try {
        fs.unlinkSync(daemonPaths(cwd).lockPath);
      } catch {
        // A failed daemon startup may not have created the lock yet.
      }
      throw error;
    }
    return;
  }

  const cwd = canonicalizeCwd(
    readFlag(parsed, "--cwd", process.cwd() === "/" ? defaultCwd() : process.cwd()),
  );
  const useDaemon =
    process.env.AUTOPR_FFF_DAEMON !== "0" &&
    !readBooleanFlag(parsed, "--no-daemon", false);
  let result;
  if (useDaemon) {
    try {
      result = await runViaDaemon(cwd, [...process.argv.slice(2), "--cwd", cwd]);
    } catch (error) {
      if (error?.code === "AUTOPR_FFF_COMMAND_ERROR") {
        throw error;
      }
      result = await runCommand(parsed);
    }
  } else {
    result = await runCommand(parsed);
  }
  printJson(result);
}

if (process.argv[1] && path.resolve(process.argv[1]) === CLI_PATH) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    printJson({ ok: false, error: message });
    process.exitCode = 1;
  });
}

export {
  buildQuery,
  daemonPaths,
  decodeCursor,
  encodeCursor,
  isWildcardOnlyPattern,
  normalizeExcludes,
  normalizePathConstraint,
  workspaceDatabasePath,
};
