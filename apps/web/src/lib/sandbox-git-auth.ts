import { hasNumberType } from "@autopr/config/runtime-type";

import type { DaytonaSandbox } from "@autopr/agent/sandbox";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function withEphemeralGitAuth<T>(
  sandbox: DaytonaSandbox,
  githubToken: string | undefined,
  operation: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const baseEnv = { GIT_TERMINAL_PROMPT: "0" };
  if (!githubToken) return operation(baseEnv);

  const authDirectory = `/tmp/autopr-git-auth-${crypto.randomUUID()}`;
  const credentialPath = `${authDirectory}/credential`;
  const askPassPath = `${authDirectory}/askpass`;
  const askPass = [
    "#!/bin/sh",
    "case \"$1\" in",
    "  *Username*) printf '%s\\n' 'x-access-token' ;;",
    `  *Password*) exec head -n 1 ${shellQuote(credentialPath)} ;;`,
    "  *) exit 1 ;;",
    "esac",
    "",
  ].join("\n");

  const created = await sandbox.process.executeCommand(
    `mkdir -m 700 ${shellQuote(authDirectory)}`,
    "/tmp",
    undefined,
    30,
  );
  if (hasNumberType(created.exitCode) && created.exitCode !== 0) {
    throw new Error("Could not create temporary Git credentials.");
  }

  let operationError: unknown;
  let result: T | undefined;
  try {
    await Promise.all([
      sandbox.fs.uploadFile(Buffer.from(githubToken), credentialPath),
      sandbox.fs.uploadFile(Buffer.from(askPass), askPassPath),
    ]);
    const secured = await sandbox.process.executeCommand(
      `chmod 600 ${shellQuote(credentialPath)} && chmod 700 ${shellQuote(askPassPath)}`,
      "/tmp",
      undefined,
      30,
    );
    if (hasNumberType(secured.exitCode) && secured.exitCode !== 0) {
      throw new Error("Could not secure temporary Git credentials.");
    }

    result = await operation({
      ...baseEnv,
      GIT_ASKPASS: askPassPath,
    });
  } catch (error) {
    operationError = error;
  }

  try {
    await sandbox.fs.deleteFile(authDirectory, true);
  } catch (cleanupError) {
    if (operationError !== undefined) {
      throw new AggregateError(
        [operationError, cleanupError],
        "Git operation and temporary credential cleanup both failed.",
      );
    }
    throw new Error("Could not remove temporary Git credentials.", { cause: cleanupError });
  }

  if (operationError !== undefined) throw operationError;
  return /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ result as T;
}

export function runAuthenticatedSandboxCommand(
  sandbox: DaytonaSandbox,
  githubToken: string | undefined,
  command: string,
  cwd: string,
  timeout = 120,
) {
  return withEphemeralGitAuth(
    sandbox,
    githubToken,
    (env) => sandbox.process.executeCommand(command, cwd, env, timeout),
  );
}
