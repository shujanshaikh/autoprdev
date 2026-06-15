#!/usr/bin/env node

import path from "node:path";
import { FileFinder, findBinary } from "@ff-labs/fff-node";

const DEFAULT_CWD = "/home/daytona/repo";
const DEFAULT_LIMIT = 50;
const DEFAULT_INDEX_TIMEOUT_MS = 10_000;
const FIND_WEAK_SAMPLE_SIZE = 5;

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
      typeof offset === "number"
        ? encodeCursor({
            type: "grep",
            offset,
          })
        : null,
  };
}

async function waitForIndex(finder, timeoutMs) {
  const waiter =
    typeof finder.waitForIndexReady === "function"
      ? finder.waitForIndexReady.bind(finder)
      : finder.waitForScan.bind(finder);
  const ready = await waiter(timeoutMs);
  if (!ready.ok) {
    throw new Error(ready.error);
  }

  return ready.value === true;
}

async function withFinder(cwd, parsed, callback) {
  const created = FileFinder.create({
    basePath: cwd,
    aiMode: true,
    frecencyDbPath: process.env.FFF_FRECENCY_DB,
    historyDbPath: process.env.FFF_HISTORY_DB,
  });

  if (!created.ok) {
    throw new Error(created.error);
  }

  const finder = created.value;

  try {
    const timeoutMs = readNumberFlag(parsed, "--index-timeout-ms", DEFAULT_INDEX_TIMEOUT_MS);
    await waitForIndex(finder, timeoutMs);

    return await callback(finder);
  } finally {
    finder.destroy();
  }
}

async function main() {
  const parsed = parseArgs(process.argv);
  const { command, positionals } = parsed;
  const cwd = readFlag(parsed, "--cwd", process.cwd() === "/" ? DEFAULT_CWD : process.cwd());

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
    });

    printJson(result);
    return;
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
    });

    printJson(result);
    return;
  }

  if (command === "grep") {
    const pattern = readFlag(parsed, "--pattern", positionals[0]);
    if (!pattern) {
      throw new Error("Missing --pattern for grep");
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
      });
      if (!search.ok) {
        throw new Error(search.error);
      }

      let value = search.value;
      let effectiveQuery = query;
      let fallback;

      const words = pattern.split(/\s+/).filter(Boolean);
      if (value.items.length === 0 && !cursor && words.length >= 2) {
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

      if (value.items.length === 0 && !cursor && effectiveMode === "plain") {
        const fuzzyPattern = cleanupFuzzyQuery(pattern);
        const fuzzyQuery = buildQuery({
          cwd,
          path: pathConstraint,
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
    });

    printJson(result);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  printJson({ ok: false, error: message });
  process.exitCode = 1;
});
