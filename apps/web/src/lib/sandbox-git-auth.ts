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
  if (typeof created.exitCode === "number" && created.exitCode !== 0) {
    throw new Error("Could not create temporary Git credentials.");
  }

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
    if (typeof secured.exitCode === "number" && secured.exitCode !== 0) {
      throw new Error("Could not secure temporary Git credentials.");
    }

    return await operation({
      ...baseEnv,
      GIT_ASKPASS: askPassPath,
      GIT_ASKPASS_REQUIRE: "force",
    });
  } finally {
    await sandbox.fs.deleteFile(authDirectory, true).catch(() => undefined);
  }
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
