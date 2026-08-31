import type { SandboxSessionOptions } from "../sandbox";
import { executeSandboxCommand, shellQuote } from "../sandbox/execute";
import { sandboxUserHome } from "../sandbox/repo-path";

const FFF_COMMAND_TIMEOUT_SECONDS = 90;
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
  const command = buildAutoprFffCommand(
    subcommand,
    flags,
    sandboxUserHome(sandboxOptions.provider ?? "daytona"),
  );
  const result = await executeSandboxCommand(command, {
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
    value: parsed as T,
    exitCode,
  };
}

function buildAutoprFffCommand(
  subcommand: string,
  flags: Record<string, FffFlagValue>,
  sandboxHome: string,
): string {
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

  const helperPaths = [
    "/opt/autopr/bin/autopr-fff",
    "/usr/local/bin/autopr-fff",
    "/usr/bin/autopr-fff",
    `${sandboxHome}/.local/bin/autopr-fff`,
    `${sandboxHome}/bin/autopr-fff`,
  ];
  const cliPaths = [
    "/opt/autopr/fff/cli.mjs",
    `${sandboxHome}/.local/share/autopr/fff/cli.mjs`,
  ];
  const pathPrefix = [
    "/opt/autopr/bin",
    "/usr/local/bin",
    "/usr/local/share/nvm/current/bin",
    `${sandboxHome}/.local/bin`,
    `${sandboxHome}/bin`,
  ].join(":");
  const quotedArgs = args.map(shellQuote).join(" ");
  const helperCandidates = helperPaths.map(shellQuote).join(" ");
  const cliCandidates = cliPaths.map(shellQuote).join(" ");
  const checkedLocations = [...helperPaths, ...cliPaths, "PATH"].join(", ");
  const notFoundJson = JSON.stringify({
    ok: false,
    error:
      `autopr-fff helper was not found in the agent process PATH or known sandbox template locations. Checked: ${checkedLocations}.`,
  });
  const nodeNotFoundJson = JSON.stringify({
    ok: false,
    error: "autopr-fff CLI file was found, but node was not available in the agent process PATH.",
  });

  return [
    `export PATH=${shellQuote(pathPrefix)}:$PATH`,
    `if ! command -v node >/dev/null 2>&1 && [ -f /usr/local/share/nvm/nvm.sh ]; then . /usr/local/share/nvm/nvm.sh >/dev/null 2>&1; nvm use default >/dev/null 2>&1 || true; fi`,
    `AUTOPR_FFF_BIN=""`,
    `AUTOPR_FFF_RUNNER="helper"`,
    `for candidate in ${helperCandidates}; do if [ -x "$candidate" ]; then AUTOPR_FFF_BIN="$candidate"; break; fi; done`,
    `if [ -z "$AUTOPR_FFF_BIN" ]; then AUTOPR_FFF_BIN="$(command -v autopr-fff 2>/dev/null || true)"; fi`,
    `if [ -z "$AUTOPR_FFF_BIN" ]; then for candidate in ${cliCandidates}; do if [ -f "$candidate" ]; then AUTOPR_FFF_BIN="$candidate"; AUTOPR_FFF_RUNNER="node"; break; fi; done; fi`,
    `if [ -n "$AUTOPR_FFF_BIN" ] && [ "$AUTOPR_FFF_RUNNER" = "node" ] && ! command -v node >/dev/null 2>&1; then printf '%s\\n' ${shellQuote(nodeNotFoundJson)}; exit 127; elif [ -n "$AUTOPR_FFF_BIN" ] && [ "$AUTOPR_FFF_RUNNER" = "node" ]; then node "$AUTOPR_FFF_BIN" ${quotedArgs}; elif [ -n "$AUTOPR_FFF_BIN" ]; then "$AUTOPR_FFF_BIN" ${quotedArgs}; else printf '%s\\n' ${shellQuote(notFoundJson)}; exit 127; fi`,
  ].join("; ");
}

function isFffErrorPayload(value: unknown): value is { ok: false; error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === false &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    "fff search failed inside the selected sandbox. Make sure its AutoPR template and PATH include the autopr-fff runtime.";

  if (!trimmed) {
    return prefix;
  }

  return `${prefix}\n\nUnderlying error: ${trimmed}`;
}
