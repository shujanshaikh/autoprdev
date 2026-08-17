import { hasObjectType, hasStringType } from "@autopr/config/runtime-type";
import { isJsonObject, type JsonObject } from "@autopr/config/runtime-value";

import type { SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand, shellQuote } from "../sandbox/execute";

const FFF_COMMAND_TIMEOUT_SECONDS = 90;
const AUTOPR_FFF_HELPER_PATHS = [
  "/opt/autopr/bin/autopr-fff",
  "/usr/local/bin/autopr-fff",
  "/usr/bin/autopr-fff",
  "/home/daytona/.local/bin/autopr-fff",
  "/home/daytona/bin/autopr-fff",
];
const AUTOPR_FFF_CLI_PATHS = [
  "/opt/autopr/fff/cli.mjs",
  "/home/daytona/.local/share/autopr/fff/cli.mjs",
];
const AUTOPR_FFF_PATH_PREFIX = [
  "/opt/autopr/bin",
  "/usr/local/bin",
  "/usr/local/share/nvm/current/bin",
  "/home/daytona/.local/bin",
  "/home/daytona/bin",
].join(":");

type FffFlagValue = string | number | boolean | undefined;

export interface AutoprFffSuccess<T> {
  ok: true;
  value: T;
  exitCode: number | null;
}

export interface AutoprFffFailure {
  ok: false;
  error: string;
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
}

export type AutoprFffResult<T> = AutoprFffSuccess<T> | AutoprFffFailure;

export async function executeAutoprFff<T>(
  subcommand: string,
  flags: Record<string, FffFlagValue>,
  sandboxOptions: SandboxSessionOptions,
): Promise<AutoprFffResult<T>> {
  const result = await executeSandboxCommand(buildAutoprFffCommand(subcommand, flags), {
    cwd: "/",
    timeout: FFF_COMMAND_TIMEOUT_SECONDS,
    sandboxOptions,
  });
  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();
  const exitCode = result.exitCode ?? null;
  const jsonText = stdout || extractJsonObject(result.output) || extractJsonObject(stderr);

  if (!jsonText) {
    return {
      ok: false,
      error: formatFffFailure(stderr || result.output || "fff returned no JSON output."),
      exitCode,
      stdout,
      stderr,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      error: formatFffFailure(stderr || stdout || "fff returned invalid JSON output."),
      exitCode,
      stdout,
      stderr,
    };
  }

  if (isFffErrorPayload(parsed)) {
    return {
      ok: false,
      error: formatFffFailure(parsed.error),
      exitCode,
      stdout,
      stderr,
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: formatFffFailure("fff returned JSON with an unexpected shape."),
      exitCode,
      stdout,
      stderr,
    };
  }

  if (exitCode !== 0) {
    return {
      ok: false,
      error: formatFffFailure(stderr || stdout || `fff exited with code ${exitCode}.`),
      exitCode,
      stdout,
      stderr,
    };
  }

  return {
    ok: true,
    value: /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ parsed as T,
    exitCode,
  };
}

function buildAutoprFffCommand(subcommand: string, flags: Record<string, FffFlagValue>): string {
  const args = [subcommand];

  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined || value === false) {
      continue;
    }

    args.push(`--${name}`);
    if (value !== true) {
      args.push(String(value));
    }
  }

  const quotedArgs = args.map(shellQuote).join(" ");
  const helperCandidates = AUTOPR_FFF_HELPER_PATHS.map(shellQuote).join(" ");
  const cliCandidates = AUTOPR_FFF_CLI_PATHS.map(shellQuote).join(" ");
  const checkedLocations = [...AUTOPR_FFF_HELPER_PATHS, ...AUTOPR_FFF_CLI_PATHS, "PATH"].join(", ");
  const notFoundJson = JSON.stringify({
    ok: false,
    error:
      `autopr-fff helper was not found in the agent process PATH or known Daytona snapshot locations. Checked: ${checkedLocations}.`,
  });
  const nodeNotFoundJson = JSON.stringify({
    ok: false,
    error: "autopr-fff CLI file was found, but node was not available in the agent process PATH.",
  });

  return [
    `export PATH=${shellQuote(AUTOPR_FFF_PATH_PREFIX)}:$PATH`,
    `if ! command -v node >/dev/null 2>&1 && [ -f /usr/local/share/nvm/nvm.sh ]; then . /usr/local/share/nvm/nvm.sh >/dev/null 2>&1; nvm use default >/dev/null 2>&1 || true; fi`,
    `AUTOPR_FFF_BIN=""`,
    `AUTOPR_FFF_RUNNER="helper"`,
    `for candidate in ${helperCandidates}; do if [ -x "$candidate" ]; then AUTOPR_FFF_BIN="$candidate"; break; fi; done`,
    `if [ -z "$AUTOPR_FFF_BIN" ]; then AUTOPR_FFF_BIN="$(command -v autopr-fff 2>/dev/null || true)"; fi`,
    `if [ -z "$AUTOPR_FFF_BIN" ]; then for candidate in ${cliCandidates}; do if [ -f "$candidate" ]; then AUTOPR_FFF_BIN="$candidate"; AUTOPR_FFF_RUNNER="node"; break; fi; done; fi`,
    `if [ -n "$AUTOPR_FFF_BIN" ] && [ "$AUTOPR_FFF_RUNNER" = "node" ] && ! command -v node >/dev/null 2>&1; then printf '%s\\n' ${shellQuote(nodeNotFoundJson)}; exit 127; elif [ -n "$AUTOPR_FFF_BIN" ] && [ "$AUTOPR_FFF_RUNNER" = "node" ]; then node "$AUTOPR_FFF_BIN" ${quotedArgs}; elif [ -n "$AUTOPR_FFF_BIN" ]; then "$AUTOPR_FFF_BIN" ${quotedArgs}; else printf '%s\\n' ${shellQuote(notFoundJson)}; exit 127; fi`,
  ].join("; ");
}

function isFffErrorPayload<ValueValue>(value: ValueValue): value is ValueValue & ({ ok: false; error: string }) {
  return (
    hasObjectType(value) &&
    value !== null &&
    "ok" in value &&
    (/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ value as { ok: unknown }).ok === false &&
    "error" in value &&
    hasStringType((/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ value as { error: unknown }).error)
  );
}

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}

function extractJsonObject(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }

  return value.slice(start, end + 1).trim();
}

function formatFffFailure(message: string): string {
  const trimmed = message.trim().slice(0, 4_000);
  const prefix =
    "fff search failed inside the Daytona sandbox. Make sure the AutoPR Daytona snapshot or sandbox PATH includes the autopr-fff runtime.";

  if (!trimmed) {
    return prefix;
  }

  return `${prefix}\n\nUnderlying error: ${trimmed}`;
}
